import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AppConfigService,
  KeyringService,
  PrismaService,
  decryptSecret,
  encryptSecret,
  generateDek,
  generateSessionSecret,
  generateUuid,
  getErrorMessage,
  needsKdfUpgrade,
} from '@makekeeper/backend-core';

// Owns the per-user data-encryption key (DEK) lifecycle for the multiuser
// overlay (#63). The DEK encrypts a user's PERSONAL secrets (their provider API
// keys, tracking credentials) and never rests in clear text:
//   - wrapped under a key derived from the login password  → UserKeyring
//   - wrapped under a random client-held session secret     → KeySession
// At login the DEK is unwrapped from the password and ARMED in the in-memory
// KeyringService; a session key is handed to the client so the DEK can be
// re-armed after a server restart without the password. An operator with only
// the database can unwrap neither copy.
// Re-arm tokens live SHORTER than the JWT on purpose (#243): the bearer
// `<sessionId>:<secret>` sits in browser storage and replays against the DEK,
// so its window is bounded independently of how long the login session lasts.
// Each successful re-arm rotates the secret (single-use) and pushes the expiry
// forward, so an actively used client never loses it; a captured copy dies at
// the first legitimate re-arm or at this TTL, whichever comes first. Past the
// window the user re-enters the password to unlock personal secrets — the
// login session itself is unaffected.
const REARM_TTL_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class KeyringSessionService {
  private readonly logger = new Logger(KeyringSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyring: KeyringService,
    private readonly config: AppConfigService,
  ) {}

  // Registration: mint a fresh DEK, wrap it under the password, arm it, and
  // issue the first session key. Returns the opaque `<sessionId>:<secret>`.
  async provision(userId: string, password: string): Promise<string> {
    const dek = generateDek();
    // The password is low-entropy, so its wrap uses the hardened KDF (#242).
    await this.prisma.userKeyring.upsert({
      where: { userId },
      create: {
        userId,
        wrappedDekPassword: encryptSecret(dek, password, 'hardened'),
      },
      update: { wrappedDekPassword: encryptSecret(dek, password, 'hardened') },
    });
    this.keyring.arm(userId, dek);
    return this.issueSession(userId, dek);
  }

  // Login: unwrap the DEK with the password and arm it, then issue a session
  // key. Two provisioning paths mint a fresh DEK:
  //   - no keyring row yet (account created before #63);
  //   - a row exists but the password no longer unwraps it — the password
  //     changed out of band without a rewrap (admin password reset). The caller
  //     has already passed the bcrypt check, so this is the account owner. Per
  //     the spec's admin-reset rule the old wrapped DEK is unrecoverable, so we
  //     re-key rather than leave the account permanently locked; the user's
  //     previously stored personal secrets (wrapped under the lost DEK) become
  //     undecryptable and are surfaced as locked until re-entered. Always
  //     returns a session key.
  async unlock(userId: string, password: string): Promise<string> {
    const row = await this.prisma.userKeyring.findUnique({ where: { userId } });
    if (!row) return this.provision(userId, password);
    const dek = decryptSecret(row.wrappedDekPassword, password);
    if (!dek) {
      this.logger.warn(
        `DEK unwrap failed for user ${userId} — password changed without rewrap; re-keying (personal secrets reset).`,
      );
      return this.provision(userId, password);
    }
    // Opportunistically upgrade a legacy default-cost wrap to the hardened KDF
    // now that we hold the password and the DEK (#242) — no bulk migration.
    if (needsKdfUpgrade(row.wrappedDekPassword, 'hardened')) {
      await this.prisma.userKeyring.update({
        where: { userId },
        data: { wrappedDekPassword: encryptSecret(dek, password, 'hardened') },
      });
    }
    this.keyring.arm(userId, dek);
    return this.issueSession(userId, dek);
  }

  // Re-arm the DEK from a client-presented session key after a cold start, when
  // the in-memory ring no longer holds it. Best-effort and idempotent: a
  // missing/expired/tampered key simply leaves the ring unarmed (the user's
  // personal secrets stay locked until they act again). `header` is the opaque
  // `<sessionId>:<secret>`.
  //
  // A successful re-arm CONSUMES the presented secret (#243): the row is
  // rewrapped under a fresh one and the replacement `<sessionId>:<secret>` is
  // returned for the caller to hand back to the client. The rotation is an
  // optimistic single-winner update — of two racing requests only one rotates,
  // and only the winner's replacement is announced, so the client never stores
  // a secret the row has already moved past. Returns null whenever there is
  // nothing for the client to update.
  async rearmFromSessionKey(
    userId: string,
    header: string,
  ): Promise<string | null> {
    if (this.keyring.isArmed(userId)) return null;
    const sep = header.indexOf(':');
    if (sep === -1) return null;
    const sessionId = header.slice(0, sep);
    const secret = header.slice(sep + 1);
    if (!sessionId || !secret) return null;
    try {
      const row = await this.prisma.keySession.findUnique({
        where: { id: sessionId },
      });
      if (!row || row.userId !== userId) return null;
      if (row.expiresAt.getTime() <= Date.now()) {
        await this.prisma.keySession
          .delete({ where: { id: sessionId } })
          .catch(() => undefined);
        return null;
      }
      const dek = decryptSecret(row.wrappedDekSession, secret);
      if (!dek) return null;
      this.keyring.arm(userId, dek);
      const nextSecret = generateSessionSecret();
      const rotated = await this.prisma.keySession.updateMany({
        // Matching on the old ciphertext is the concurrency lock: a parallel
        // request that already rotated leaves nothing for this filter to hit.
        where: { id: sessionId, wrappedDekSession: row.wrappedDekSession },
        data: {
          wrappedDekSession: encryptSecret(dek, nextSecret),
          expiresAt: new Date(Date.now() + REARM_TTL_MS),
        },
      });
      return rotated.count === 1 ? `${sessionId}:${nextSecret}` : null;
    } catch (err) {
      this.logger.warn(`Session re-arm failed: ${getErrorMessage(err)}`);
      return null;
    }
  }

  // Logout: drop the presented session row so its client-held secret can never
  // re-arm the DEK after a restart. The in-memory DEK is intentionally NOT
  // disarmed — per the #63 retention rule it stays armed until the process
  // restarts so background jobs acting for the (now offline) user keep working;
  // a cold restart empties the ring and this session can no longer re-arm it.
  // Other sessions of the same user keep their own re-arm tokens.
  async revoke(userId: string, header?: string): Promise<void> {
    if (!header) return;
    const sep = header.indexOf(':');
    const sessionId = sep === -1 ? header : header.slice(0, sep);
    if (!sessionId) return;
    await this.prisma.keySession
      .deleteMany({ where: { id: sessionId, userId } })
      .catch((err: unknown) =>
        this.logger.warn(`Session revoke failed: ${getErrorMessage(err)}`),
      );
  }

  // Scheduled housekeeping: drop expired re-arm tokens. Returns the count.
  // Harmless while the overlay is disabled (there simply are no rows). The
  // registration decorator fires regardless of plugin-enable state, mirroring
  // the other plugins' nightly jobs.
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupExpired(): Promise<number> {
    try {
      const { count } = await this.prisma.keySession.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      return count;
    } catch (err) {
      this.logger.warn(`Session cleanup failed: ${getErrorMessage(err)}`);
      return 0;
    }
  }

  private async issueSession(userId: string, dek: string): Promise<string> {
    const secret = generateSessionSecret();
    const id = 'ks_' + generateUuid();
    // Deliberately NOT the JWT TTL — see REARM_TTL_MS. Capped by the JWT TTL
    // so an operator who configures very short login sessions never leaves a
    // re-arm token outliving them.
    const ttlMs = Math.min(REARM_TTL_MS, this.config.getJwtTtlSeconds() * 1000);
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.keySession.create({
      data: {
        id,
        userId,
        wrappedDekSession: encryptSecret(dek, secret),
        expiresAt,
      },
    });
    return `${id}:${secret}`;
  }
}
