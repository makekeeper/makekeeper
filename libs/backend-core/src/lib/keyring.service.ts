import { Injectable, Logger } from '@nestjs/common';

// In-memory store of unwrapped per-user data-encryption keys (DEKs). A DEK never
// touches the database in the clear — it lives here only, wrapped at rest under
// the user's password KEK and under a client-held session secret (see the
// multiuser overlay). The multiuser plugin ARMS a user's DEK at login and can
// re-arm it from a session secret after a server restart; every other plugin
// only READS a DEK to decrypt that user's personal secrets.
//
// Retention: a DEK stays armed until the process restarts (NOT cleared on
// logout) — this is what lets background jobs act for an offline user. A cold
// restart empties the ring; the first authenticated request that carries the
// user's session secret re-arms it transparently.
//
// Lives in backend-core (not the multiuser plugin) because consumers such as the
// chat provider layer must read DEKs without importing another plugin. When the
// multiuser overlay is off, nothing ever arms the ring and `getDek` always
// returns null — consumers then fall back to instance-key encryption.
@Injectable()
export class KeyringService {
  private readonly logger = new Logger(KeyringService.name);
  private readonly deks = new Map<string, string>();

  arm(userId: string, dek: string): void {
    this.deks.set(userId, dek);
  }

  isArmed(userId: string): boolean {
    return this.deks.has(userId);
  }

  // The user's DEK if armed, else null. Null means "this user's personal secrets
  // are currently locked" — the caller skips the work and surfaces a re-auth
  // prompt rather than failing hard.
  getDek(userId: string): string | null {
    return this.deks.get(userId) ?? null;
  }

  // Drop one user's DEK — blocking or deleting an account must lock only that
  // user's secrets, not disturb every other armed session.
  clearForUser(userId: string): void {
    this.deks.delete(userId);
  }

  // Drop every DEK — used when the multiuser overlay is disabled at runtime, so
  // no unwrapped key lingers after the feature that armed it is gone.
  clear(): void {
    const count = this.deks.size;
    this.deks.clear();
    if (count > 0) {
      this.logger.log(
        `Cleared ${count} armed keyring entr${count === 1 ? 'y' : 'ies'}.`,
      );
    }
  }
}
