import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, getErrorMessage } from '@makekeeper/backend-core';
import {
  DEFAULT_ATTACHMENT_RULES,
  MAX_MAX_NON_IMAGE_BYTES,
  MAX_MAX_READ_BYTES,
  MIN_ATTACHMENT_LIMIT_BYTES,
  normaliseAttachmentRuleList,
  type AttachmentRules,
} from '@makekeeper/plugin-contract';
import { ProviderService } from './providers.service';

// Row id of the instance ruleset. The id IS the owner, so a second instance
// row cannot exist (see the schema comment).
const INSTANCE_ID = 'instance';

// Where the ruleset that governs a chat attachment comes from — reported to the
// settings UI so it can say "inherited" instead of pretending the user set it.
export type AttachmentRulesSource = 'personal' | 'instance' | 'default';

export interface EffectiveAttachmentRules extends AttachmentRules {
  source: AttachmentRulesSource;
}

// The chat plugin's attachment ruleset (#112).
//
// Ownership follows the money: the rules that apply are those of whoever owns
// the ACTIVE connection, because that is who pays for whatever the model is
// fed. Resolution therefore does NOT re-implement the connection cascade — it
// asks `ProviderService` who the active owner is and reads that owner's row,
// falling back to the instance row and then to the code defaults (no provider
// configured, a locked personal connection, single-user mode).
//
// Lists are stored newline-separated rather than as a relation: they are a
// user-edited free list, never queried by element.
@Injectable()
export class AttachmentSettingsService {
  private readonly logger = new Logger(AttachmentSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderService,
  ) {}

  // The ruleset governing what the CURRENT caller may attach.
  async resolveEffective(): Promise<EffectiveAttachmentRules> {
    const ownerUserId = await this.activeOwnerUserId();
    if (ownerUserId) {
      const personal = await this.read(ownerUserId);
      if (personal) return { ...personal, source: 'personal' };
    }
    const instance = await this.read(null);
    if (instance) return { ...instance, source: 'instance' };
    return { ...DEFAULT_ATTACHMENT_RULES, source: 'default' };
  }

  // The stored row for one owner, or null when that owner never saved any —
  // the settings UI needs the difference to render "inherited".
  async read(ownerUserId: string | null): Promise<AttachmentRules | null> {
    try {
      const row = await this.prisma.chatAttachmentSettings.findUnique({
        where: { id: ownerUserId ?? INSTANCE_ID },
      });
      if (!row) return null;
      return {
        mimeTypes: splitList(row.mimeTypes),
        extensions: splitList(row.extensions),
        maxNonImageBytes: row.maxNonImageBytes,
        maxReadBytes: row.maxReadBytes,
      };
    } catch (err) {
      // A broken settings read must not make the chat unusable: fall back to
      // the defaults and say so in the log.
      this.logger.error(
        `Failed to read attachment settings for ${ownerUserId ?? INSTANCE_ID}: ${getErrorMessage(err)}`,
      );
      return null;
    }
  }

  async save(
    ownerUserId: string | null,
    rules: AttachmentRules,
  ): Promise<AttachmentRules> {
    const sanitised = sanitise(rules);
    const id = ownerUserId ?? INSTANCE_ID;
    const data = {
      ownerUserId,
      mimeTypes: sanitised.mimeTypes.join('\n'),
      extensions: sanitised.extensions.join('\n'),
      maxNonImageBytes: sanitised.maxNonImageBytes,
      maxReadBytes: sanitised.maxReadBytes,
    };
    // `ChatAttachmentSettings` is unscoped (SCOPE_MODEL_MAP), so the no-upsert
    // rule for scoped models does not apply and one round trip is enough.
    await this.prisma.chatAttachmentSettings.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    return sanitised;
  }

  // Dropping the row is how an owner returns to the inherited ruleset — the
  // same "deselect to inherit" gesture the connection list uses.
  async clear(ownerUserId: string | null): Promise<void> {
    await this.prisma.chatAttachmentSettings.deleteMany({
      where: { id: ownerUserId ?? INSTANCE_ID },
    });
  }

  // Who owns the connection this caller's turns actually run on. Null in
  // single-user mode and whenever the active connection is an instance one.
  //
  // `resolveActiveRuntime`, not `resolveActiveConfig`: a connection whose DEK
  // is not armed (offline owner, signed-out guest) cannot run a turn at all,
  // so nobody is paying and its owner's ruleset must not apply — that is the
  // `locked` case the fallback to the instance row exists for.
  private async activeOwnerUserId(): Promise<string | null> {
    try {
      const resolved = await this.providers.resolveActiveRuntime();
      return resolved.status === 'ready' ? resolved.ownerUserId : null;
    } catch (err) {
      this.logger.warn(
        `Failed to resolve the active connection owner: ${getErrorMessage(err)}`,
      );
      return null;
    }
  }
}

function splitList(value: string): string[] {
  return normaliseAttachmentRuleList(value.split('\n'));
}

function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function sanitise(rules: AttachmentRules): AttachmentRules {
  return {
    mimeTypes: normaliseAttachmentRuleList(rules.mimeTypes),
    extensions: normaliseAttachmentRuleList(rules.extensions),
    maxNonImageBytes: clamp(
      rules.maxNonImageBytes,
      MIN_ATTACHMENT_LIMIT_BYTES,
      MAX_MAX_NON_IMAGE_BYTES,
      DEFAULT_ATTACHMENT_RULES.maxNonImageBytes,
    ),
    maxReadBytes: clamp(
      rules.maxReadBytes,
      MIN_ATTACHMENT_LIMIT_BYTES,
      MAX_MAX_READ_BYTES,
      DEFAULT_ATTACHMENT_RULES.maxReadBytes,
    ),
  };
}
