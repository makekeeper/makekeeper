import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  PluginRegistryService,
  PrismaService,
  SecretBoxService,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_CONTRACT_VERSION,
  ExternalPluginManifest,
  ExternalRegisterRequest,
  ExternalRegisterResponse,
  PLUGIN_PURGE_PATH,
  validateExternalManifest,
} from '@makekeeper/plugin-contract';
import { detectExpansion, grantsAfterApply } from './manifest-diff';
import { ExternalTokensService } from './external-tokens.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';
import {
  ExternalPluginStatus,
  PendingPayload,
  isExternalPluginStatus,
  readStoredGrants,
  readStoredManifest,
  readStoredPending,
} from './persisted';

// Lifecycle owner of external plugins (#133): registration (fresh installs and
// the update diff policy), consent, enable/disable, uninstall. Rows in
// ExternalPlugin are the core's entire knowledge of a plugin; this service is
// the only writer.

export type { ExternalPluginStatus } from './persisted';

// Admin projection of one external plugin (list + consent card).
export interface ExternalPluginAdminView {
  pluginId: string;
  status: ExternalPluginStatus;
  baseUrl: string;
  version: string;
  contract: { major: number; minor: number };
  manifest: ExternalPluginManifest;
  grants: string[];
  assistantEnabled: boolean;
  errorCode: string | null;
  pending: {
    manifest: ExternalPluginManifest;
    baseUrl: string;
    version: string;
    reasons: Array<{ code: string; detail: string }>;
  } | null;
  createdAt: string;
  updatedAt: string;
}

// A loaded, ACTIVE external plugin as later phases consume it (render proxy,
// tools, webhooks): manifest + decrypted secret + live grants.
export interface ActiveExternalPlugin {
  pluginId: string;
  baseUrl: string;
  manifest: ExternalPluginManifest;
  grants: string[];
  secret: string;
  scopeId: string | null;
  assistantEnabled: boolean;
}

const PURGE_TIMEOUT_MS = 30_000;

// A row whose stored manifest no longer passes the registration validator
// still has to be visible to the admin (to reject, uninstall or wait for the
// container's next announce) — surface it as an error card, not a crash.
const unreadableManifestFallback = (row: {
  pluginId: string;
  version: string;
  contractMajor: number;
  contractMinor: number;
}): ExternalPluginManifest => ({
  contract: { major: row.contractMajor, minor: row.contractMinor },
  pluginId: row.pluginId,
  version: row.version,
  // No bundle behind the key: the admin card's name resolution falls back to
  // the pluginId, which is the only honest name left.
  nameKey: 'name',
  icon: 'plug',
  scopeModel: 'instance',
  permissions: [],
  i18n: { en: {} },
  screens: [],
});

@Injectable()
export class ExternalRegistryService {
  private readonly logger = new Logger(ExternalRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
    private readonly secretBox: SecretBoxService,
    private readonly tokens: ExternalTokensService,
    private readonly signer: ExternalSignerService,
    private readonly breaker: ExternalBreakerService,
  ) {}

  // ── Registration (plugin → core) ──────────────────────────────────────────
  // Machine caller: failures come back as stable error CODES (the SDK and the
  // admin UI map them to i18n), never resolved prose.
  // The manifest arrives untyped on purpose: the contract validator is the
  // only thing that turns it into an ExternalPluginManifest.

  async register(
    req: Omit<ExternalRegisterRequest, 'manifest'> & { manifest: unknown },
  ): Promise<ExternalRegisterResponse> {
    const validated = validateExternalManifest(req.manifest);
    if (validated.ok === false) {
      const unsupported = validated.errors.some(
        (e) => e.code === 'contract-unsupported',
      );
      return {
        error: unsupported ? 'unsupported-contract' : 'invalid-manifest',
      };
    }
    const manifest = validated.manifest;
    if (typeof req.baseUrl !== 'string' || !/^https?:\/\//.test(req.baseUrl)) {
      return { error: 'invalid-base-url' };
    }

    const existing = await this.prisma.externalPlugin.findUnique({
      where: { pluginId: manifest.pluginId },
    });

    // Re-announce path: the plugin authenticates with its issued secret; the
    // same secret spans versions (a changed pluginId is a different plugin).
    if (req.pluginSecret) {
      if (!existing) return { error: 'unknown-plugin' };
      const secret = this.secretBox.decrypt(existing.secretEnc);
      if (!secret || secret !== req.pluginSecret) {
        return { error: 'bad-secret' };
      }
      return this.applyUpdate(existing.pluginId, manifest, req.baseUrl);
    }

    // Fresh install path: one-time install token, id must be free across both
    // internal plugins and external rows.
    if (!req.installToken) return { error: 'missing-credentials' };
    if (existing) return { error: 'id-taken' };
    if (this.registry.getPlugins().some((p) => p.id === manifest.pluginId)) {
      return { error: 'id-taken' };
    }
    const burned = await this.tokens.consumeInstallToken(
      req.installToken,
      manifest.pluginId,
    );
    if (!burned) return { error: 'bad-install-token' };

    const secret = this.tokens.newPluginSecret();
    await this.prisma.externalPlugin.create({
      data: {
        pluginId: manifest.pluginId,
        status: 'pending',
        baseUrl: req.baseUrl,
        version: manifest.version,
        contractMajor: manifest.contract.major,
        contractMinor: manifest.contract.minor,
        manifestJson: JSON.stringify(manifest),
        // Nothing is granted until the admin approves the consent card.
        grantsJson: '[]',
        secretEnc: this.secretBox.encrypt(secret),
      },
    });
    this.logger.log(
      `external plugin registered (pending): ${manifest.pluginId}`,
    );
    return {
      status: 'pending',
      pluginSecret: secret,
      contract: { ...EXTERNAL_CONTRACT_VERSION },
    };
  }

  // Update diff policy (decision #15): non-expanding manifests apply silently
  // (grants become exactly the requested set — narrowing included); an
  // expanding manifest parks WHOLE as pending and the plugin keeps running
  // with the old manifest + old grants.
  private async applyUpdate(
    pluginId: string,
    manifest: ExternalPluginManifest,
    baseUrl: string,
  ): Promise<ExternalRegisterResponse> {
    const row = await this.prisma.externalPlugin.findUniqueOrThrow({
      where: { pluginId },
    });
    if (manifest.pluginId !== pluginId) return { error: 'plugin-id-mismatch' };

    // Still awaiting the INSTALL consent: refresh the presented manifest
    // in place — nothing is granted yet, so there is nothing to expand.
    if (row.status === 'pending') {
      await this.prisma.externalPlugin.update({
        where: { pluginId },
        data: {
          baseUrl,
          version: manifest.version,
          contractMajor: manifest.contract.major,
          contractMinor: manifest.contract.minor,
          manifestJson: JSON.stringify(manifest),
        },
      });
      return { status: 'pending', contract: { ...EXTERNAL_CONTRACT_VERSION } };
    }

    const current = readStoredManifest(row.manifestJson);
    const grants = readStoredGrants(row.grantsJson);
    // A stored manifest we can no longer read gives nothing to diff against:
    // park the update for consent — the admin re-approves from a clean slate.
    const diff = current
      ? detectExpansion(current, grants, manifest)
      : {
          expansion: true,
          reasons: [
            { code: 'stored-manifest-unreadable', detail: row.version },
          ],
        };

    if (diff.expansion) {
      const pending: PendingPayload = {
        manifest,
        baseUrl,
        version: manifest.version,
        reasons: diff.reasons,
      };
      await this.prisma.externalPlugin.update({
        where: { pluginId },
        data: { pendingJson: JSON.stringify(pending) },
      });
      this.logger.log(
        `external plugin update parked pending consent: ${pluginId}`,
      );
      return {
        status: row.status === 'disabled' ? 'pending' : 'active',
        contract: { ...EXTERNAL_CONTRACT_VERSION },
      };
    }

    const narrowed = grantsAfterApply(manifest);
    await this.prisma.externalPlugin.update({
      where: { pluginId },
      data: {
        baseUrl,
        version: manifest.version,
        contractMajor: manifest.contract.major,
        contractMinor: manifest.contract.minor,
        manifestJson: JSON.stringify(manifest),
        grantsJson: JSON.stringify(narrowed),
        // A superseded pending update is dropped — the new manifest is the
        // author's current word.
        pendingJson: null,
      },
    });
    // Narrowing may have shrunk what background tokens are allowed to touch;
    // re-issue rather than trust the old context (decision #15).
    if (narrowed.length < grants.length) {
      await this.tokens.revokeBackgroundForPlugin(pluginId);
    }
    return { status: 'active', contract: { ...EXTERNAL_CONTRACT_VERSION } };
  }

  // ── Consent & lifecycle (admin → core) ────────────────────────────────────
  // Admin surfaces throw stable error codes; the controller maps them onto
  // HTTP + the frontend resolves `external.errors.<code>` via $t (§5.5).

  async approve(pluginId: string): Promise<void> {
    const row = await this.requireRow(pluginId);
    if (row.status === 'pending') {
      const manifest = readStoredManifest(row.manifestJson);
      if (!manifest) throw new Error('manifest-unreadable');
      await this.prisma.externalPlugin.update({
        where: { pluginId },
        data: {
          status: 'active',
          grantsJson: JSON.stringify(grantsAfterApply(manifest)),
        },
      });
      this.logger.log(`external plugin approved: ${pluginId}`);
      return;
    }
    if (row.pendingJson) {
      const pending = readStoredPending(row.pendingJson);
      if (!pending) throw new Error('manifest-unreadable');
      await this.prisma.externalPlugin.update({
        where: { pluginId },
        data: {
          status: row.status,
          baseUrl: pending.baseUrl,
          version: pending.version,
          contractMajor: pending.manifest.contract.major,
          contractMinor: pending.manifest.contract.minor,
          manifestJson: JSON.stringify(pending.manifest),
          grantsJson: JSON.stringify(grantsAfterApply(pending.manifest)),
          pendingJson: null,
        },
      });
      // The grant set changed shape: standing background tokens are re-issued
      // under the new grants on the plugin's next announce.
      await this.tokens.revokeBackgroundForPlugin(pluginId);
      this.logger.log(`external plugin update approved: ${pluginId}`);
      return;
    }
    throw new Error('not-pending');
  }

  // Rejecting an INSTALL removes the registration entirely; rejecting an
  // UPDATE just drops the parked manifest (the plugin keeps running as-is).
  async reject(pluginId: string): Promise<void> {
    const row = await this.requireRow(pluginId);
    if (row.status === 'pending') {
      await this.tokens.revokeAllForPlugin(pluginId);
      await this.prisma.externalPlugin.delete({ where: { pluginId } });
      this.logger.log(`external plugin registration rejected: ${pluginId}`);
      return;
    }
    if (row.pendingJson) {
      await this.prisma.externalPlugin.update({
        where: { pluginId },
        data: { pendingJson: null },
      });
      return;
    }
    throw new Error('not-pending');
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const row = await this.requireRow(pluginId);
    if (row.status !== 'active' && row.status !== 'disabled') {
      throw new Error('not-pending');
    }
    await this.prisma.externalPlugin.update({
      where: { pluginId },
      data: { status: enabled ? 'active' : 'disabled' },
    });
    // A plugin coming back should not inherit the breaker state that its
    // downtime left behind. (The lifecycle EVENT is published by the caller:
    // the events service reads this registry, so emitting from here would
    // close a DI cycle — the admin controller is the transaction boundary.)
    if (enabled) this.breaker.forget(pluginId);
  }

  // Uninstall (decision #16): tokens die FIRST, then the optional purge hook
  // (best-effort — the container belongs to the admin), then the row.
  async uninstall(
    pluginId: string,
    purge: boolean,
  ): Promise<{ purgeFailed: boolean }> {
    const row = await this.requireRow(pluginId);
    await this.tokens.revokeAllForPlugin(pluginId);

    let purgeFailed = false;
    const manifest = readStoredManifest(row.manifestJson);
    if (purge && !manifest) {
      // We cannot know whether a purge hook was declared: report the purge as
      // failed so the admin hears "the plugin's own data may remain".
      purgeFailed = true;
    }
    if (purge && manifest?.purgeHook) {
      const secret = this.secretBox.decrypt(row.secretEnc);
      if (secret) {
        const res = await this.signer.post(
          row.baseUrl,
          secret,
          PLUGIN_PURGE_PATH,
          {},
          PURGE_TIMEOUT_MS,
        );
        purgeFailed = !res.ok;
      } else {
        purgeFailed = true;
      }
    }

    await this.prisma.externalPlugin.delete({ where: { pluginId } });
    this.breaker.forget(pluginId);
    this.logger.log(`external plugin uninstalled: ${pluginId}`);
    return { purgeFailed };
  }

  async setAssistantEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await this.requireRow(pluginId);
    await this.prisma.externalPlugin.update({
      where: { pluginId },
      data: { assistantEnabled: enabled },
    });
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  async listAdmin(): Promise<ExternalPluginAdminView[]> {
    const rows = await this.prisma.externalPlugin.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => {
      // An unreadable parked update is silently dropped from the view: the
      // container's next announce parks a fresh, readable one.
      const pending = row.pendingJson
        ? readStoredPending(row.pendingJson)
        : null;
      const manifest = readStoredManifest(row.manifestJson);
      if (!manifest) {
        this.logger.error(`stored manifest unreadable: ${row.pluginId}`);
      }
      return {
        pluginId: row.pluginId,
        status: !manifest
          ? 'error'
          : isExternalPluginStatus(row.status)
            ? row.status
            : 'error',
        baseUrl: row.baseUrl,
        version: row.version,
        contract: { major: row.contractMajor, minor: row.contractMinor },
        manifest: manifest ?? unreadableManifestFallback(row),
        grants: readStoredGrants(row.grantsJson),
        assistantEnabled: row.assistantEnabled,
        errorCode: row.errorCode,
        pending,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async getActive(pluginId: string): Promise<ActiveExternalPlugin | null> {
    const row = await this.prisma.externalPlugin.findUnique({
      where: { pluginId },
    });
    if (!row || row.status !== 'active') return null;
    const secret = this.secretBox.decrypt(row.secretEnc);
    if (!secret) return null;
    const manifest = readStoredManifest(row.manifestJson);
    if (!manifest) {
      // Decision #15: invalid manifest → the plugin's surfaces degrade; the
      // admin card (listAdmin) is where the state becomes visible.
      this.logger.error(`stored manifest unreadable: ${row.pluginId}`);
      return null;
    }
    return {
      pluginId: row.pluginId,
      baseUrl: row.baseUrl,
      manifest,
      grants: readStoredGrants(row.grantsJson),
      secret,
      scopeId: row.boundScopeId,
      assistantEnabled: row.assistantEnabled,
    };
  }

  // The salt behind a plugin's opaque user references (#156). Created on first
  // use and never rotated: the ref IS an identity as far as the plugin is
  // concerned — rotating the salt would orphan everything it stored under it.
  async userRefSalt(pluginId: string): Promise<string | null> {
    const row = await this.prisma.externalPlugin.findUnique({
      where: { pluginId },
      select: { userRefSalt: true },
    });
    if (!row) return null;
    if (row.userRefSalt) return row.userRefSalt;
    const salt = randomBytes(32).toString('base64url');
    await this.prisma.externalPlugin.update({
      where: { pluginId },
      data: { userRefSalt: salt },
    });
    return salt;
  }

  async listActive(): Promise<ActiveExternalPlugin[]> {
    const rows = await this.prisma.externalPlugin.findMany({
      where: { status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    const out: ActiveExternalPlugin[] = [];
    for (const row of rows) {
      const secret = this.secretBox.decrypt(row.secretEnc);
      if (!secret) continue;
      const manifest = readStoredManifest(row.manifestJson);
      if (!manifest) {
        this.logger.error(`stored manifest unreadable: ${row.pluginId}`);
        continue;
      }
      out.push({
        pluginId: row.pluginId,
        baseUrl: row.baseUrl,
        manifest,
        grants: readStoredGrants(row.grantsJson),
        secret,
        scopeId: row.boundScopeId,
        assistantEnabled: row.assistantEnabled,
      });
    }
    return out;
  }

  private async requireRow(pluginId: string): Promise<{
    pluginId: string;
    status: string;
    baseUrl: string;
    manifestJson: string;
    grantsJson: string;
    pendingJson: string | null;
    secretEnc: string;
  }> {
    const row = await this.prisma.externalPlugin.findUnique({
      where: { pluginId },
    });
    if (!row) throw new Error('not-found');
    return row;
  }
}
