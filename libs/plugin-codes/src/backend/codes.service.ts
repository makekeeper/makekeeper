import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AgentRegistryService,
  AppConfigService,
  CapabilityRegistryService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
  generateUuid,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';
import {
  CODES_RAW_RESOLVE_CAPABILITY,
  PHONE_BRIDGE_SESSION_CAPABILITY,
  type CodesRawResolveCapability,
  type PhoneBridgeSessionCapability,
  parseObjectRef,
} from '@makekeeper/plugin-contract';
import {
  CROCKFORD_ALPHABET,
  CODE_RANDOM_LENGTH,
  codePrefixForRef,
  extractDeepLinkCode,
  isLabelCode,
  normalizeCode,
} from '../code-format';

// A label as returned to callers: the object it names, its short code, and the
// permanent `/c/<code>` deep-link (derived from the request host, never stored).
export interface ResolvedLabel {
  id: string;
  code: string;
  ref: string;
  url: string;
}

@Injectable()
export class CodesService {
  private readonly logger = new Logger(CodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  private randomBase32(length: number): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += CROCKFORD_ALPHABET[bytes[i] % CROCKFORD_ALPHABET.length];
    }
    return out;
  }

  private async generateUniqueCode(prefix: string): Promise<string> {
    // 33M combinations per prefix, so collisions are rare; retry a few times
    // before widening the random part rather than ever returning a dup.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const random = this.randomBase32(
        CODE_RANDOM_LENGTH + (attempt >= 5 ? 1 : 0),
      );
      const code = `${prefix}-${random}`;
      const existing = await this.prisma.label.findUnique({ where: { code } });
      if (!existing) return code;
    }
    // Astronomically unlikely; keep it deterministic rather than throwing.
    return `${prefix}-${this.randomBase32(CODE_RANDOM_LENGTH + 2)}`;
  }

  // Create (or return the existing) label for an object reference. Idempotent per
  // ref — one canonical label per object.
  async ensureLabel(
    ref: string,
    req: RequestHeadersLike,
    locale?: string,
  ): Promise<ResolvedLabel> {
    const parsed = parseObjectRef(ref);
    if (!parsed) {
      throw new BadRequestException(
        this.i18n.t('codes.errors.invalidRef', { ref }, locale),
      );
    }
    const existing = await this.prisma.label.findUnique({ where: { ref } });
    const label =
      existing ??
      (await this.prisma.label.create({
        data: {
          id: generateUuid(),
          code: await this.generateUniqueCode(codePrefixForRef(parsed)),
          ref,
        },
      }));
    return this.toResolved(label, req);
  }

  async getByRef(
    ref: string,
    req: RequestHeadersLike,
  ): Promise<ResolvedLabel | null> {
    const label = await this.prisma.label.findUnique({ where: { ref } });
    return label ? this.toResolved(label, req) : null;
  }

  async deleteByCodeOrRef(codeOrRef: string): Promise<boolean> {
    const label = parseObjectRef(codeOrRef)
      ? await this.prisma.label.findUnique({ where: { ref: codeOrRef } })
      : await this.prisma.label.findUnique({
          where: { code: normalizeCode(codeOrRef) },
        });
    if (!label) return false;
    await this.prisma.label.delete({ where: { id: label.id } });
    return true;
  }

  // Public `/c/<code>` resolver: find the object a label code names, regardless
  // of which user's scope created it (the deep-link is public and permanent), so
  // the lookup runs with scope enforcement suspended.
  //
  // Accepted residual risk (#243): this is anonymous and cross-scope by design —
  // a native camera opening the printed QR has no app session — so a caller can
  // probe codes across every user's scope. It is deliberately bounded to leak
  // only the opaque ORef (existence + entity type + id), never a name or any
  // content: names come from the bridge-token-gated scan/preview path, and the
  // SPA's follow-up fetch is scope-enforced. The code's random part is small, so
  // the space is enumerable; guarding it further (per-IP throttle on this route)
  // is tracked as a follow-up rather than done here.
  async resolveCode(code: string): Promise<string | null> {
    const normalized = normalizeCode(code);
    if (!isLabelCode(normalized)) return null;
    const label = await this.requestContext.runWithoutScope(
      'public-code-deeplink',
      () => this.prisma.label.findUnique({ where: { code: normalized } }),
    );
    return label?.ref ?? null;
  }

  // Unified scan resolution for a raw string decoded from any code the user
  // points a phone at: our QR deep-link, our short code, a bare ORef, or a
  // foreign barcode/SKU (delegated to whichever plugin can map it). Returns the
  // canonical ORef, or null when nothing matches.
  async resolveScan(value: string): Promise<string | null> {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // 1) Our QR encodes a `/c/<code>` deep-link.
    const deepLinkCode = extractDeepLinkCode(trimmed);
    if (deepLinkCode) {
      const ref = await this.resolveCode(deepLinkCode);
      if (ref) return ref;
    }

    // 2) A bare canonical ORef (e.g. encoded directly in a QR).
    if (parseObjectRef(trimmed)) return trimmed;

    // 3) Our short label code (carried by the 1D barcode).
    if (isLabelCode(trimmed)) {
      const ref = await this.resolveCode(trimmed);
      if (ref) return ref;
    }

    // 4) A foreign code (manufacturer barcode / SKU): let a resolver plugin map
    //    it. Null (unregistered or owner disabled) ⇒ no mapping.
    return this.rawResolve(trimmed);
  }

  private rawResolve(value: string): Promise<string | null> {
    const resolver = this.capabilities.getCapability<CodesRawResolveCapability>(
      CODES_RAW_RESOLVE_CAPABILITY,
    );
    return resolver ? resolver.resolveRawCode(value) : Promise.resolve(null);
  }

  // Resolve a scanned value to the object's name + canonical ref, for the agent
  // `resolve_code` tool.
  async describeScan(
    value: string,
  ): Promise<{ ref: string; displayName: string; breadcrumb?: string } | null> {
    const ref = await this.resolveScan(value);
    if (!ref) return null;
    const info = await this.agentRegistry.resolveObjectRef(ref);
    return {
      ref,
      displayName: info?.displayName ?? '',
      breadcrumb: info?.breadcrumb,
    };
  }

  // Phone-side scan preview (public route, anonymous phone). Returns what a
  // scanned value points to so the phone can show it and ask the user to confirm
  // before the desktop navigates. The name is resolved with scope enforcement
  // suspended (like the `/c/<code>` deep-link) so the unauthenticated phone can
  // display it; the desktop stays the authoritative resolver on confirm.
  //
  // Because the route is public, gate it on the caller's live phone-bridge
  // session token so only the phone in an open scan session can resolve names —
  // not any anonymous caller enumerating codes. Fail closed: a disabled bridge
  // (capability null) yields the empty preview, and a token that names no live
  // session yields 410 so the phone can distinguish "your session is over" from
  // "this code is unknown" (#79).
  async previewScan(
    value: string,
    token: string,
  ): Promise<{
    value: string;
    ref: string | null;
    displayName: string | null;
    breadcrumb: string | null;
  }> {
    const empty = { value, ref: null, displayName: null, breadcrumb: null };
    const bridge =
      this.capabilities.getCapability<PhoneBridgeSessionCapability>(
        PHONE_BRIDGE_SESSION_CAPABILITY,
      );
    if (!bridge) return empty;
    // A dead session is NOT "code not found": the desktop may have ended this
    // session (or started another one) while the phone was still scanning, and
    // answering with an empty preview would tell the user their perfectly valid
    // label is unknown. 410 lets the phone say the truth — the session is over.
    if (!(await bridge.isActiveSession(token))) {
      throw new GoneException(this.i18n.t('codes.errors.sessionEnded'));
    }

    const ref = await this.resolveScan(value);
    if (!ref) return empty;
    const info = await this.requestContext.runWithoutScope(
      'public-code-deeplink',
      () => this.agentRegistry.resolveObjectRef(ref),
    );
    return {
      value,
      ref,
      displayName: info?.displayName ?? null,
      breadcrumb: info?.breadcrumb ?? null,
    };
  }

  private toResolved(
    label: { id: string; code: string; ref: string },
    req: RequestHeadersLike,
  ): ResolvedLabel {
    return {
      id: label.id,
      code: label.code,
      ref: label.ref,
      url: `${this.config.resolvePublicBaseUrl(req)}/c/${label.code}`,
    };
  }
}
