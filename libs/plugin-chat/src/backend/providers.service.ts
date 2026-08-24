import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  RequestContextData,
  RequestContextService,
  SecretBoxService,
  KeyringService,
  SecretAccessService,
  TransliterationService,
  encryptSecret,
  decryptSecret,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import type { AIProviderConfig } from '@prisma/client';
import { chatManifest } from '../manifest';
import { isPubliclyRoutableUrl } from './url-safety';
import {
  PROVIDER_TYPES,
  IMAGE_DETAILS,
  REASONING_EFFORTS,
  DEFAULT_BASE_URLS,
  type ProviderType,
  type ImageDetail,
  type ReasoningEffort,
} from './providers.dto';
import {
  checkProxyHeaderName,
  formatProxyLabelSegments,
  normalizeProxyLabelSegment,
  parseProxyLabelSegments,
} from '../proxy-label';

// Public projection of a provider config: the raw apiKey is never returned to
// the client — only whether a key is stored (so the UI can offer a
// "leave blank to keep current" flow when editing).
export type PublicProviderConfig = Omit<AIProviderConfig, 'apiKey'> & {
  hasApiKey: boolean;
};

// The resolved connection for a runtime turn (#63). `ready` carries a config
// whose `apiKey` is already DECRYPTED and safe to hand to the provider call.
// `locked` means the resolved connection is a personal one whose owner's DEK is
// not currently armed (the owner is offline after a server restart, or a guest
// is using their shared key while they are signed out) — the caller surfaces a
// re-auth notice instead of failing hard. `none` means no connection at all.
export type ResolvedProviderConfig =
  | { status: 'ready'; config: AIProviderConfig; ownerUserId: string | null }
  | { status: 'locked'; ownerUserId: string }
  | { status: 'none' };

type FieldRule = 'required' | 'optional' | 'hidden';

interface ProviderFieldRules {
  apiKey: FieldRule;
  baseUrl: FieldRule;
  organizationId: FieldRule;
  apiVersion: FieldRule;
  // imageDetail + reasoningEffort tune the OpenAI vision/reasoning request; only
  // the openai branch in ChatService reads them, so they are hidden elsewhere.
  imageDetail: FieldRule;
  reasoningEffort: FieldRule;
}

// Which parameters each provider actually needs. modelName + name are always
// required, so they are not listed here. Keep in sync with the frontend
// fieldConfig and PROVIDER_TYPES.
const PROVIDER_FIELD_RULES: Record<ProviderType, ProviderFieldRules> = {
  gemini: {
    apiKey: 'required',
    baseUrl: 'optional',
    organizationId: 'hidden',
    apiVersion: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  openai: {
    apiKey: 'required',
    baseUrl: 'optional',
    organizationId: 'optional',
    apiVersion: 'hidden',
    imageDetail: 'optional',
    reasoningEffort: 'optional',
  },
  anthropic: {
    apiKey: 'required',
    baseUrl: 'optional',
    organizationId: 'hidden',
    apiVersion: 'optional',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  ollama: {
    apiKey: 'hidden',
    baseUrl: 'required',
    organizationId: 'hidden',
    apiVersion: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  custom: {
    apiKey: 'optional',
    baseUrl: 'required',
    organizationId: 'hidden',
    apiVersion: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
};

interface ProviderValues {
  name: string;
  provider: ProviderType;
  apiKey: string | null;
  baseUrl: string | null;
  modelName: string;
  organizationId: string | null;
  apiVersion: string | null;
  imageDetail: ImageDetail | null;
  reasoningEffort: ReasoningEffort | null;
  // Proxy request labelling (#230). Not in PROVIDER_FIELD_RULES: these three are
  // gated on the endpoint differing from the vendor default, which is a value
  // check, not a per-provider-type rule.
  proxyLabel: string | null;
  proxyLabelSegments: string | null;
  proxyHeaderName: string | null;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
}

// Anthropic's `anthropic-version` header value — a sensible current default.
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

// AI provider configuration is the Chat plugin's own settings: the chat/agent
// runtime talks to whichever provider is marked default (see ChatService).
@Injectable()
export class ProviderService implements OnModuleInit {
  private readonly logger = new Logger(ProviderService.name);

  // Per-request memo of the resolved active connection, keyed on the request's
  // context object (a fresh object per HTTP request — GC drops the entry when
  // the request ends). One chat message drives several agent-loop turns plus a
  // status poll, each of which resolved the same 3-4 queries from scratch.
  private readonly activeConfigByRequest = new WeakMap<
    RequestContextData,
    Promise<AIProviderConfig | null>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly requestContext: RequestContextService,
    private readonly secretBox: SecretBoxService,
    private readonly keyring: KeyringService,
    private readonly secretAccess: SecretAccessService,
    private readonly transliteration: TransliterationService,
  ) {}

  // One-time migration of legacy plaintext INSTANCE keys to ciphertext at rest.
  // Personal keys cannot be sealed here (the owner's DEK is not armed at boot) —
  // they are sealed lazily on first authenticated use (see decryptStoredApiKey).
  async onModuleInit(): Promise<void> {
    try {
      const instanceRows = await this.prisma.aIProviderConfig.findMany({
        where: { ownerUserId: null },
      });
      let migrated = 0;
      for (const row of instanceRows) {
        if (row.apiKey && !this.secretBox.isEncrypted(row.apiKey)) {
          await this.prisma.aIProviderConfig.update({
            where: { id: row.id },
            data: { apiKey: this.secretBox.encrypt(row.apiKey) },
          });
          migrated += 1;
        }
      }
      if (migrated > 0) {
        this.logger.log(
          `Encrypted ${migrated} legacy plaintext instance provider key(s) at rest.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Provider key migration failed: ${getErrorMessage(err)}`,
      );
    }
  }

  // ── Secret encryption at rest (#63) ────────────────────────────────────────

  // Encrypt an apiKey for storage. Instance connections (ownerUserId null) use
  // the app secret; personal connections use the owner's DEK, so an operator
  // with DB + env still cannot read them. A blank key stores null. Throws an
  // i18n-keyed error if a personal owner's DEK is not armed (their session is
  // locked) — the write is refused rather than stored unreadable or in clear.
  private encryptApiKeyForStore(
    apiKey: string | null,
    ownerUserId: string | null,
  ): string | null {
    if (!apiKey) return null;
    if (ownerUserId === null) return this.secretBox.encrypt(apiKey);
    const dek = this.keyring.getDek(ownerUserId);
    if (!dek) {
      throw new BadRequestException(
        this.i18n.t('providerSettings.validation.sessionLocked'),
      );
    }
    return encryptSecret(apiKey, dek);
  }

  // Decrypt a stored apiKey for use. Handles legacy plaintext (values predating
  // #63 that are not yet ciphertext) transparently, and lazily seals a legacy
  // personal key once the owner's DEK is available. Returns a discriminated
  // result so a locked personal connection degrades cleanly.
  private async decryptStoredApiKey(
    config: AIProviderConfig,
  ): Promise<
    | { status: 'ok'; apiKey: string | null }
    | { status: 'locked'; ownerUserId: string }
  > {
    const stored = config.apiKey;
    if (!stored) return { status: 'ok', apiKey: null };

    // Instance connection: app-secret encrypted, or legacy plaintext.
    if (config.ownerUserId === null) {
      if (!this.secretBox.isEncrypted(stored)) {
        return { status: 'ok', apiKey: stored };
      }
      return { status: 'ok', apiKey: this.secretBox.decrypt(stored) };
    }

    // Personal connection: needs the owner's armed DEK.
    const dek = this.keyring.getDek(config.ownerUserId);
    if (!dek) return { status: 'locked', ownerUserId: config.ownerUserId };

    if (!this.secretBox.isEncrypted(stored)) {
      // Legacy plaintext personal key — seal it now that we hold the DEK.
      const sealed = encryptSecret(stored, dek);
      await this.prisma.aIProviderConfig
        .update({ where: { id: config.id }, data: { apiKey: sealed } })
        .catch((err: unknown) =>
          this.logger.error(
            `Failed to seal legacy personal key ${config.id}: ${getErrorMessage(err)}`,
          ),
        );
      return { status: 'ok', apiKey: stored };
    }
    return { status: 'ok', apiKey: decryptSecret(stored, dek) };
  }

  // Instance connections (admin-managed; ownerUserId NULL).
  async findAll(): Promise<PublicProviderConfig[]> {
    const configs = await this.prisma.aIProviderConfig.findMany({
      where: { ownerUserId: null },
      orderBy: { createdAt: 'asc' },
    });
    return configs.map((c) => this.toPublic(c));
  }

  // The caller's personal connections.
  async findPersonal(ownerUserId: string): Promise<PublicProviderConfig[]> {
    const configs = await this.prisma.aIProviderConfig.findMany({
      where: { ownerUserId },
      orderBy: { createdAt: 'asc' },
    });
    return configs.map((c) => this.toPublic(c));
  }

  // Which credentials serve the CURRENT request:
  //   1. the caller's own default (or only) connection;
  //   2. in someone else's workspace — a connection its owner shared with
  //      workspace guests;
  //   3. the instance default, if the admin shared it with everyone
  //      (admins reach it regardless).
  // Single-user mode (no request context) keeps today's behavior — the
  // instance default, unconditionally.
  async resolveActiveConfig(): Promise<AIProviderConfig | null> {
    const rc = this.requestContext.get();
    // No context (single-user mode): a single query, nothing to memoize.
    if (!rc?.userId) {
      return this.prisma.aIProviderConfig.findFirst({
        where: { ownerUserId: null, isDefault: true },
      });
    }
    const memoized = this.activeConfigByRequest.get(rc);
    if (memoized) return memoized;
    const promise = this.computeActiveConfig(rc);
    this.activeConfigByRequest.set(rc, promise);
    return promise;
  }

  private async computeActiveConfig(
    rc: RequestContextData,
  ): Promise<AIProviderConfig | null> {
    // Only an EXPLICITLY selected own connection wins — deselecting all of
    // them is how the user returns to the inherited/shared one (the first
    // created connection is auto-selected, see create()).
    const personal = await this.prisma.aIProviderConfig.findFirst({
      where: { ownerUserId: rc.userId, isDefault: true },
    });
    if (personal) return personal;
    const ownersShared = await this.findOwnersShared();
    if (ownersShared) return ownersShared;
    return this.prisma.aIProviderConfig.findFirst({
      where: {
        ownerUserId: null,
        isDefault: true,
        ...(rc.isAdmin ? {} : { sharedWith: 'everyone' }),
      },
    });
  }

  // The workspace owner's guest-shared connection, when the caller is working
  // inside someone else's workspace. An admin owner shares via the INSTANCE
  // rows (ownerless), so for an admin-owned workspace those count too.
  private async findOwnersShared(): Promise<AIProviderConfig | null> {
    const rc = this.requestContext.get();
    if (!rc?.userId || !rc.scopeId || rc.scopeId === rc.userId) return null;
    const shared = await this.prisma.aIProviderConfig.findFirst({
      where: { ownerUserId: rc.scopeId, sharedWith: 'workspace-guests' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (shared) return shared;
    // Cross-domain read of the User row on purpose: the chat plugin only asks
    // "is the scope owner an admin" — no multiuser service dependency.
    const owner = await this.prisma.user.findUnique({
      where: { id: rc.scopeId },
      select: { isAdmin: true },
    });
    if (!owner?.isAdmin) return null;
    return this.prisma.aIProviderConfig.findFirst({
      where: { ownerUserId: null, sharedWith: 'workspace-guests' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // The connection a regular user inherits "from above" — shown as a pinned
  // read-only row in their personal panel. In someone else's workspace the
  // owner's guest-shared connection outranks the instance one (mirrors
  // resolveActiveConfig). Public projection only; null when nothing is shared.
  async getSharedForUsers(): Promise<{
    connection: PublicProviderConfig;
    source: 'workspace-owner' | 'instance';
  } | null> {
    const ownersShared = await this.findOwnersShared();
    if (ownersShared) {
      return {
        connection: this.toPublic(ownersShared),
        source: 'workspace-owner',
      };
    }
    const shared = await this.prisma.aIProviderConfig.findFirst({
      where: { ownerUserId: null, isDefault: true, sharedWith: 'everyone' },
    });
    return shared
      ? { connection: this.toPublic(shared), source: 'instance' }
      : null;
  }

  // The active connection for a runtime turn, with its apiKey DECRYPTED and
  // ready to use (#63). Wraps resolveActiveConfig with the secret layer so the
  // chat runtime never touches ciphertext or the keyring directly. A `locked`
  // result means the owner's DEK is not armed (offline owner / signed-out guest).
  async resolveActiveRuntime(): Promise<ResolvedProviderConfig> {
    const active = await this.resolveActiveConfig();
    if (!active) return { status: 'none' };
    const decrypted = await this.decryptStoredApiKey(active);
    if (decrypted.status === 'locked') {
      return { status: 'locked', ownerUserId: decrypted.ownerUserId };
    }
    // In-memory copy with the plaintext key — never persisted back.
    const config: AIProviderConfig = { ...active, apiKey: decrypted.apiKey };
    return { status: 'ready', config, ownerUserId: active.ownerUserId };
  }

  // Whether the resolved connection's owner is someone other than the current
  // actor (a guest using a shared key, or an unattended background job) — in
  // which case the use is audited and the owner is notified (#63). No-op for a
  // user's own key or an instance connection (no per-user owner to protect).
  async recordRuntimeUse(ownerUserId: string | null): Promise<void> {
    if (ownerUserId === null) return;
    const actorUserId = this.requestContext.get()?.userId ?? null;
    if (actorUserId === ownerUserId) return;
    await this.secretAccess.recordOutOfSessionUse({
      ownerUserId,
      pluginId: chatManifest.id,
      purposeKey: 'chat.secretAccess.llmCall',
    });
  }

  // Connection indicator for the chat header, safe for every user: exposes
  // only the resolved connection's display name and reachability — no configs.
  async getActiveStatus(): Promise<{ name: string | null; ok: boolean }> {
    const resolved = await this.resolveActiveRuntime();
    if (resolved.status === 'none') return { name: null, ok: false };
    if (resolved.status === 'locked') return { name: null, ok: false };
    const active = resolved.config;
    // Probe the connection as actually configured — passing the stored baseUrl/
    // org/version, not just the id (which would only recover the apiKey and
    // leave a custom endpoint tested against the provider default → false red).
    const result = await this.testConnection({
      provider: active.provider,
      apiKey: active.apiKey ?? undefined,
      baseUrl: active.baseUrl ?? undefined,
      organizationId: active.organizationId ?? undefined,
      apiVersion: active.apiVersion ?? undefined,
    });
    return { name: active.name, ok: result.ok };
  }

  async create(
    data: {
      name: string;
      provider: string;
      apiKey?: string;
      baseUrl?: string;
      modelName: string;
      organizationId?: string;
      apiVersion?: string;
      imageDetail?: ImageDetail;
      reasoningEffort?: ReasoningEffort;
      sharedWith?: string;
      proxyLabel?: string;
      proxyLabelSegments?: string;
      proxyHeaderName?: string;
    },
    // NULL = instance connection (admin panel); a user id = personal one.
    ownerUserId: string | null = null,
  ): Promise<PublicProviderConfig> {
    const values = this.normalize({
      name: data.name,
      provider: this.assertProviderType(data.provider),
      apiKey: data.apiKey ?? null,
      baseUrl: data.baseUrl ?? null,
      modelName: data.modelName,
      organizationId: data.organizationId ?? null,
      apiVersion: data.apiVersion ?? null,
      imageDetail: data.imageDetail ?? null,
      reasoningEffort: data.reasoningEffort ?? null,
      proxyLabel: data.proxyLabel ?? null,
      proxyLabelSegments: data.proxyLabelSegments ?? null,
      proxyHeaderName: data.proxyHeaderName ?? null,
    });
    this.validate(values);

    // The namespace's first connection is auto-selected — a user's single
    // connection should just work without hunting for the radio.
    const isFirst =
      (await this.prisma.aIProviderConfig.count({ where: { ownerUserId } })) ===
      0;
    const created = await this.prisma.aIProviderConfig.create({
      data: {
        id: 'prov_' + generateUuid(),
        ...values,
        // Encrypt the key at rest: instance key for admin connections, the
        // owner's DEK for personal ones (#63). `values.apiKey` is post-normalize
        // plaintext (null when the provider takes no key).
        apiKey: this.encryptApiKeyForStore(values.apiKey, ownerUserId),
        isDefault: isFirst,
        ownerUserId,
        sharedWith: this.assertSharedWith(
          // Instance connections keep today's behavior (usable by everyone)
          // unless the admin restricts them; personal ones start private.
          data.sharedWith ?? (ownerUserId === null ? 'everyone' : 'none'),
          ownerUserId,
        ),
      },
    });
    return this.toPublic(created);
  }

  async update(
    id: string,
    data: {
      name?: string;
      provider?: string;
      apiKey?: string | null;
      baseUrl?: string;
      modelName?: string;
      organizationId?: string;
      apiVersion?: string;
      imageDetail?: ImageDetail;
      reasoningEffort?: ReasoningEffort;
      sharedWith?: string;
      proxyLabel?: string;
      proxyLabelSegments?: string;
      proxyHeaderName?: string;
    },
    ownerUserId: string | null = null,
  ): Promise<PublicProviderConfig> {
    const existing = await this.requireOwned(id, ownerUserId);

    // A blank/omitted apiKey means "keep the stored secret" — the client sends
    // nothing when it wants no change. An explicit null is the opposite signal:
    // drop the stored key (#220), which `validate` still refuses for a provider
    // that requires one. For validation and provider-rule normalization we
    // represent "a key exists" with the stored ciphertext (its presence is all
    // `validate` checks); the value actually persisted is computed separately
    // below so ciphertext never gets double-encrypted.
    const keepExisting = data.apiKey === undefined || data.apiKey === '';
    const nextApiKey = keepExisting ? existing.apiKey : (data.apiKey ?? null);

    const values = this.normalize({
      name: data.name ?? existing.name,
      provider: this.assertProviderType(data.provider ?? existing.provider),
      apiKey: nextApiKey,
      baseUrl: data.baseUrl ?? existing.baseUrl,
      modelName: data.modelName ?? existing.modelName,
      organizationId: data.organizationId ?? existing.organizationId,
      apiVersion: data.apiVersion ?? existing.apiVersion,
      imageDetail: data.imageDetail ?? this.asImageDetail(existing.imageDetail),
      reasoningEffort:
        data.reasoningEffort ??
        this.asReasoningEffort(existing.reasoningEffort),
      proxyLabel: data.proxyLabel ?? existing.proxyLabel,
      proxyLabelSegments:
        data.proxyLabelSegments ?? existing.proxyLabelSegments,
      proxyHeaderName: data.proxyHeaderName ?? existing.proxyHeaderName,
    });
    this.validate(values);

    // Decide the ciphertext to persist (overriding the plaintext `values.apiKey`
    // that normalize produced). Null when the provider takes no key (a provider
    // switch clears a stale key); the untouched stored ciphertext when the caller
    // sent no new key; otherwise the freshly supplied key encrypted at the right
    // layer (instance secret vs. the owner's DEK).
    const apiKeyToStore: string | null =
      values.apiKey === null
        ? null
        : keepExisting
          ? existing.apiKey
          : this.encryptApiKeyForStore(data.apiKey ?? null, ownerUserId);

    const updated = await this.prisma.aIProviderConfig.update({
      where: { id },
      data: {
        ...values,
        apiKey: apiKeyToStore,
        ...(data.sharedWith !== undefined && {
          sharedWith: this.assertSharedWith(data.sharedWith, ownerUserId),
        }),
      },
    });
    return this.toPublic(updated);
  }

  // Default is per namespace: one per user, one for the instance.
  async setDefault(
    id: string,
    ownerUserId: string | null = null,
  ): Promise<PublicProviderConfig> {
    await this.requireOwned(id, ownerUserId);
    await this.prisma.aIProviderConfig.updateMany({
      where: { ownerUserId },
      data: { isDefault: false },
    });
    const updated = await this.prisma.aIProviderConfig.update({
      where: { id },
      data: { isDefault: true },
    });
    return this.toPublic(updated);
  }

  // Deselect every connection of the namespace — the resolution then falls
  // through to the inherited/shared one.
  async clearDefault(ownerUserId: string | null): Promise<void> {
    await this.prisma.aIProviderConfig.updateMany({
      where: { ownerUserId },
      data: { isDefault: false },
    });
  }

  async delete(
    id: string,
    ownerUserId: string | null = null,
  ): Promise<PublicProviderConfig> {
    await this.requireOwned(id, ownerUserId);
    const deleted = await this.prisma.aIProviderConfig.delete({
      where: { id },
    });
    return this.toPublic(deleted);
  }

  // Ownership gate for every mutating/personal operation: a connection outside
  // the caller's namespace behaves as if it doesn't exist (404, not 403 — no
  // existence oracle across namespaces).
  private async requireOwned(
    id: string,
    ownerUserId: string | null,
  ): Promise<AIProviderConfig> {
    const existing = await this.prisma.aIProviderConfig.findUnique({
      where: { id },
    });
    if (!existing || existing.ownerUserId !== ownerUserId) {
      throw new NotFoundException(
        this.i18n.t('providerSettings.validation.unknownConnection'),
      );
    }
    return existing;
  }

  // A personal connection may be opened to guests of the owner's workspace;
  // an instance one to every user and/or to guests of an admin's workspace
  // (the admin IS a workspace owner too).
  private assertSharedWith(value: string, ownerUserId: string | null): string {
    const allowed =
      ownerUserId === null
        ? ['none', 'workspace-guests', 'everyone']
        : ['none', 'workspace-guests'];
    if (!allowed.includes(value)) {
      throw new BadRequestException(
        this.i18n.t('providerSettings.validation.invalidSharing'),
      );
    }
    return value;
  }

  // Minimal connectivity + credential check: hits the provider's model-listing
  // endpoint (cheap, no token cost) and reports whether it authenticates. When
  // apiKey is blank and `id` is given, the stored key is used so an existing
  // provider can be tested without re-entering its secret.
  async testConnection(
    data: {
      provider: string;
      id?: string;
      apiKey?: string;
      baseUrl?: string;
      organizationId?: string;
      apiVersion?: string;
    },
    // When set, a stored connection referenced by id must belong to this
    // namespace (personal test endpoint); undefined = trusted internal call.
    expectedOwner?: string | null,
    // Untrusted callers (the personal test route) must not be able to make the
    // server probe its internal network / cloud metadata — see url-safety.ts.
    // Trusted paths (admin test, status probe) leave this false so a legitimate
    // localhost/LAN provider still works.
    options?: { blockPrivateHosts?: boolean },
  ): Promise<TestConnectionResult> {
    const provider = this.assertProviderType(data.provider);
    const rules = PROVIDER_FIELD_RULES[provider];

    let apiKey = data.apiKey?.trim() || null;
    if (!apiKey && data.id) {
      const existing =
        expectedOwner !== undefined
          ? await this.requireOwned(data.id, expectedOwner)
          : await this.prisma.aIProviderConfig.findUnique({
              where: { id: data.id },
            });
      // The stored key is encrypted at rest (#63); decrypt it for the probe. A
      // locked personal connection (owner's DEK not armed) yields no usable key
      // and falls through to the required-key check below.
      if (existing) {
        const decrypted = await this.decryptStoredApiKey(existing);
        apiKey = decrypted.status === 'ok' ? decrypted.apiKey : null;
      }
    }
    const baseUrl = data.baseUrl?.trim() || DEFAULT_BASE_URLS[provider] || null;

    if (rules.apiKey === 'required' && !apiKey) {
      return {
        ok: false,
        error: this.i18n.t('providerSettings.validation.apiKeyRequired'),
      };
    }
    if (rules.baseUrl === 'required' && !baseUrl) {
      return {
        ok: false,
        error: this.i18n.t('providerSettings.validation.baseUrlRequired'),
      };
    }

    if (
      options?.blockPrivateHosts &&
      baseUrl &&
      !(await isPubliclyRoutableUrl(baseUrl))
    ) {
      return {
        ok: false,
        error: this.i18n.t('providerSettings.validation.blockedHost'),
      };
    }

    const request = this.buildTestRequest(
      provider,
      apiKey,
      baseUrl,
      data.organizationId?.trim() || null,
      data.apiVersion?.trim() || null,
    );

    // Bound the probe so a wrong/unreachable host can't hang the request.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(request.url, {
        method: 'GET',
        headers: request.headers,
        signal: controller.signal,
      });
      if (response.ok) return { ok: true };
      const body = (await response.text()).slice(0, 200);
      return {
        ok: false,
        error: `HTTP ${response.status}${body ? `: ${body}` : ''}`,
      };
    } catch (err) {
      return { ok: false, error: getErrorMessage(err) };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Builds the model-listing probe (URL + headers) for each provider.
  private buildTestRequest(
    provider: ProviderType,
    apiKey: string | null,
    baseUrl: string | null,
    organizationId: string | null,
    apiVersion: string | null,
  ): { url: string; headers: Record<string, string> } {
    const base = (baseUrl ?? DEFAULT_BASE_URLS[provider]).replace(/\/+$/, '');
    const headers: Record<string, string> = {};

    switch (provider) {
      case 'gemini':
        return {
          url: `${base}/v1beta/models?key=${encodeURIComponent(apiKey ?? '')}`,
          headers,
        };
      case 'anthropic':
        headers['x-api-key'] = apiKey ?? '';
        headers['anthropic-version'] = apiVersion || DEFAULT_ANTHROPIC_VERSION;
        return { url: `${base}/models`, headers };
      case 'ollama':
        return { url: `${base}/api/tags`, headers };
      case 'openai':
      case 'custom':
      default:
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        if (organizationId) headers['OpenAI-Organization'] = organizationId;
        return { url: `${base}/models`, headers };
    }
  }

  private toPublic(config: AIProviderConfig): PublicProviderConfig {
    const { apiKey, ...rest } = config;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }

  private assertProviderType(value: string): ProviderType {
    if ((PROVIDER_TYPES as readonly string[]).includes(value)) {
      return value as ProviderType;
    }
    throw new BadRequestException(
      this.i18n.t('chat.errors.unknownProviderType', { type: value }),
    );
  }

  // The form's preview half (#230): raw values in, header-safe segments out.
  // Tables live on the server only, so the browser cannot normalise locally —
  // it sends what the user sees and shows what would actually leave.
  normalizeProxyLabelValues(values: readonly string[]): string[] {
    return values.map((value) =>
      normalizeProxyLabelSegment(value, this.transliteration.transliterate),
    );
  }

  // Drop values for fields the selected provider does not use, so stored data
  // always matches the provider (e.g. switching to Ollama clears a stale key).
  private normalize(values: ProviderValues): ProviderValues {
    const rules = PROVIDER_FIELD_RULES[values.provider];
    // "The user emptied the field" and "the field does not apply here" are the
    // same state — store NULL for both, never a blank string (#220).
    const blankToNull = (value: string | null): string | null =>
      value?.trim() || null;
    // Collapse the "use the model default" sentinels to null so the DB only ever
    // stores a value that changes request behaviour ("high" / an explicit effort).
    const imageDetail =
      rules.imageDetail === 'hidden' || values.imageDetail === 'auto'
        ? null
        : values.imageDetail;
    const reasoningEffort =
      rules.reasoningEffort === 'hidden' || values.reasoningEffort === 'default'
        ? null
        : values.reasoningEffort;
    return {
      ...values,
      apiKey: rules.apiKey === 'hidden' ? null : values.apiKey,
      baseUrl: rules.baseUrl === 'hidden' ? null : blankToNull(values.baseUrl),
      organizationId:
        rules.organizationId === 'hidden'
          ? null
          : blankToNull(values.organizationId),
      apiVersion:
        rules.apiVersion === 'hidden' ? null : blankToNull(values.apiVersion),
      imageDetail,
      reasoningEffort,
      proxyLabel: blankToNull(values.proxyLabel),
      // Canonicalised, never blank-to-null: an empty selection (every segment
      // switched off) is a real state and must round-trip as "", because NULL is
      // read as the default single `label` segment.
      proxyLabelSegments:
        values.proxyLabelSegments === null
          ? null
          : formatProxyLabelSegments(
              parseProxyLabelSegments(values.proxyLabelSegments),
            ),
      proxyHeaderName: blankToNull(values.proxyHeaderName),
    };
  }

  // Narrow a raw DB string (String? column) back to the typed union, tolerating
  // any legacy/invalid value by falling back to null (= model default).
  private asImageDetail(value: string | null): ImageDetail | null {
    return value && (IMAGE_DETAILS as readonly string[]).includes(value)
      ? (value as ImageDetail)
      : null;
  }

  private asReasoningEffort(value: string | null): ReasoningEffort | null {
    return value && (REASONING_EFFORTS as readonly string[]).includes(value)
      ? (value as ReasoningEffort)
      : null;
  }

  // Backend safety net for the per-provider required-field rules. The client
  // validates the same rules with localized messages before submitting.
  private validate(values: ProviderValues): void {
    if (!values.name.trim()) {
      throw new BadRequestException(
        this.i18n.t('providerSettings.validation.nameRequired'),
      );
    }
    if (!values.modelName.trim()) {
      throw new BadRequestException(
        this.i18n.t('providerSettings.validation.modelRequired'),
      );
    }

    // The header name is the one field here a user types straight into the wire
    // format, so it is refused at the form rather than inside fetch a day later.
    if (values.proxyHeaderName) {
      const verdict = checkProxyHeaderName(values.proxyHeaderName);
      if (verdict === 'malformed') {
        throw new BadRequestException(
          this.i18n.t('providerSettings.validation.proxyHeaderNameInvalid'),
        );
      }
      if (verdict === 'reserved') {
        throw new BadRequestException(
          this.i18n.t('providerSettings.validation.proxyHeaderNameReserved'),
        );
      }
    }

    const rules = PROVIDER_FIELD_RULES[values.provider];
    if (rules.apiKey === 'required' && !values.apiKey) {
      throw new BadRequestException(
        this.i18n.t('providerSettings.validation.apiKeyRequired'),
      );
    }
    if (rules.baseUrl === 'required' && !values.baseUrl?.trim()) {
      throw new BadRequestException(
        this.i18n.t('providerSettings.validation.baseUrlRequired'),
      );
    }
  }
}
