import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  AppConfigService,
  PrismaService,
  generateUuid,
} from '@makekeeper/backend-core';
import type { ExternalAccessClass } from '@makekeeper/plugin-contract';
import { isExternalAccessClass } from './persisted';
import {
  isExternalTokenCeiling,
  type ExternalConnectionTokenView,
  type ExternalTokenCeiling,
} from '../external-types';

// Tokens issued around external plugins (#133). Four families, each with a
// distinguishing prefix so a leaked string is at least identifiable:
//   mki_ — one-time install token (admin → plugin env → registration)
//   mkd_ — short-lived delegated token (bound to a user; interactive calls)
//   mkb_ — standing background token (per the plugin's scope model)
//   mkt_ — long-lived connection token (an outside consumer, e.g. an MCP
//          client, acting as the issuing user under an access ceiling; #249)
// The plugin SECRET (mkp_) is stored encrypted on the ExternalPlugin row by
// the registry service; only these four live in the token tables, and only
// as SHA-256 hashes — the clear value exists once, in the issuing response.

const INSTALL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DELEGATED_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface VerifiedAccessToken {
  pluginId: string;
  class: ExternalAccessClass;
  userId: string | null;
  scopeId: string | null;
}

export interface VerifiedConnectionToken {
  tokenId: string;
  ceiling: ExternalTokenCeiling;
  userId: string | null;
  scopeId: string | null;
}

// Connection tokens are the only family a HUMAN pastes into a foreign config
// file, so the prefix doubles as a cheap router: the guard picks the table to
// verify against by it instead of querying both on every call.
export const CONNECTION_TOKEN_PREFIX = 'mkt_';

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const newToken = (prefix: string): string =>
  `${prefix}${randomBytes(32).toString('base64url')}`;

@Injectable()
export class ExternalTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  // ── Install tokens ────────────────────────────────────────────────────────

  // Dev mode (#139): with MK_EXTERNAL_DEV=1 the core accepts a fixed install
  // token from the environment, so a plugin under development registers with
  // one command instead of a UI round-trip per restart. Deliberately gated on
  // an explicit env flag and never on NODE_ENV — a production image must not
  // acquire a standing install credential because someone forgot a variable.
  private devInstallToken(): string | null {
    return this.config.getExternalDevInstallToken();
  }

  async createInstallToken(): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken('mki_');
    const expiresAt = new Date(Date.now() + INSTALL_TOKEN_TTL_MS);
    await this.prisma.externalInstallToken.create({
      data: { id: generateUuid(), tokenHash: hashToken(token), expiresAt },
    });
    return { token, expiresAt };
  }

  // Burns the token for the registering plugin. False = unknown, expired or
  // already used — the registration is refused.
  async consumeInstallToken(token: string, pluginId: string): Promise<boolean> {
    // The dev token is reusable by design: a plugin being iterated on
    // re-registers on every restart, and burning it each time would defeat
    // the purpose.
    const dev = this.devInstallToken();
    if (dev !== null && token === dev) return true;
    const row = await this.prisma.externalInstallToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.usedByPluginId !== null || row.expiresAt < new Date()) {
      return false;
    }
    await this.prisma.externalInstallToken.update({
      where: { id: row.id },
      data: { usedByPluginId: pluginId },
    });
    return true;
  }

  // ── Plugin secret ─────────────────────────────────────────────────────────

  newPluginSecret(): string {
    return newToken('mkp_');
  }

  // ── Access tokens ─────────────────────────────────────────────────────────

  async issueDelegated(
    pluginId: string,
    userId: string | null,
    scopeId: string | null,
  ): Promise<string> {
    const token = newToken('mkd_');
    await this.prisma.externalAccessToken.create({
      data: {
        id: generateUuid(),
        tokenHash: hashToken(token),
        pluginId,
        class: 'delegated',
        userId,
        grantScopeId: scopeId,
        expiresAt: new Date(Date.now() + DELEGATED_TOKEN_TTL_MS),
      },
    });
    return token;
  }

  async issueBackground(
    pluginId: string,
    cls: Exclude<ExternalAccessClass, 'delegated'>,
    scopeId: string | null,
  ): Promise<string> {
    const token = newToken('mkb_');
    await this.prisma.externalAccessToken.create({
      data: {
        id: generateUuid(),
        tokenHash: hashToken(token),
        pluginId,
        class: cls,
        grantScopeId: scopeId,
      },
    });
    return token;
  }

  async verify(token: string): Promise<VerifiedAccessToken | null> {
    const row = await this.prisma.externalAccessToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.revokedAt !== null) return null;
    if (row.expiresAt !== null && row.expiresAt < new Date()) return null;
    // A class value outside the known set is a token this code cannot reason
    // about — treat it as invalid rather than cast and guess.
    if (!isExternalAccessClass(row.class)) return null;
    return {
      pluginId: row.pluginId,
      class: row.class,
      userId: row.userId,
      scopeId: row.grantScopeId,
    };
  }

  // ── Connection tokens (#249) ──────────────────────────────────────────────
  // Long-lived, user-bound, ceiling-clamped. Rows are filtered by the ISSUING
  // user on every management call: under multiuser each admin manages only
  // their own tokens, and in single-user mode everything is issued (and
  // listed) with no user at all.

  private connectionView(row: {
    id: string;
    label: string;
    ceiling: string;
    createdAt: Date;
  }): ExternalConnectionTokenView {
    return {
      id: row.id,
      label: row.label,
      // A ceiling outside the known set is clamped to the safest reading for
      // display; verify() rejects such a token outright.
      ceiling: isExternalTokenCeiling(row.ceiling) ? row.ceiling : 'read-only',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async issueConnection(
    label: string,
    ceiling: ExternalTokenCeiling,
    userId: string | null,
    scopeId: string | null,
  ): Promise<{ token: string; view: ExternalConnectionTokenView }> {
    const token = newToken(CONNECTION_TOKEN_PREFIX);
    const row = await this.prisma.externalConnectionToken.create({
      data: {
        id: generateUuid(),
        tokenHash: hashToken(token),
        label,
        ceiling,
        userId,
        grantScopeId: scopeId,
      },
    });
    return { token, view: this.connectionView(row) };
  }

  async listConnection(
    userId: string | null,
  ): Promise<ExternalConnectionTokenView[]> {
    const rows = await this.prisma.externalConnectionToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.connectionView(row));
  }

  // Both mutations key on (id AND issuing user): another user's token id is
  // indistinguishable from an unknown one.
  async relabelConnection(
    id: string,
    userId: string | null,
    label: string,
  ): Promise<boolean> {
    const res = await this.prisma.externalConnectionToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { label },
    });
    return res.count > 0;
  }

  async revokeConnection(id: string, userId: string | null): Promise<boolean> {
    const res = await this.prisma.externalConnectionToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count > 0;
  }

  async verifyConnection(
    token: string,
  ): Promise<VerifiedConnectionToken | null> {
    const row = await this.prisma.externalConnectionToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.revokedAt !== null) return null;
    // Same reasoning as verify(): an unknown ceiling is a token this code
    // cannot reason about — invalid, not guessed at.
    if (!isExternalTokenCeiling(row.ceiling)) return null;
    return {
      tokenId: row.id,
      ceiling: row.ceiling,
      userId: row.userId,
      scopeId: row.grantScopeId,
    };
  }

  // Uninstall's FIRST action (decision #16): every outstanding token of the
  // plugin dies before any cleanup or purge call runs.
  async revokeAllForPlugin(pluginId: string): Promise<void> {
    await this.prisma.externalAccessToken.updateMany({
      where: { pluginId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Standing background tokens are re-issued after a grant change so the old
  // grant context can't linger inside a still-valid token.
  async revokeBackgroundForPlugin(pluginId: string): Promise<void> {
    await this.prisma.externalAccessToken.updateMany({
      where: {
        pluginId,
        revokedAt: null,
        class: { in: ['background-scoped', 'background-instance'] },
      },
      data: { revokedAt: new Date() },
    });
  }
}
