import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { decryptSecret, encryptSecret, isEncrypted } from './crypto-box';

// The instance-key facade over crypto-box: encrypts secrets that the server must
// be able to read on its own — provider API keys of instance connections, the
// logistics tracking password/key — under the app secret (APP_SECRET). Per-user
// personal secrets are NOT handled here; they are encrypted under the caller's
// DEK (see KeyringService) so an operator with DB + env still cannot read them.
//
// Fails the boot when APP_SECRET is missing or too short, so there is no runtime
// path that could silently store a secret in clear text — a misconfigured
// instance never starts rather than degrading to plaintext.
@Injectable()
export class SecretBoxService implements OnModuleInit {
  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    // Fatal boot error: thrown as an i18n key (resolved prose lives in the core
    // bundle, apps/backend/src/app/i18n/{en,ru}.json) — never literal prose (§5.5),
    // mirroring PrismaService's `core.errors.unknownModel`.
    if (!this.config.getAppSecret()) {
      throw new Error('core.errors.appSecretMissing');
    }
  }

  private secret(): string {
    const secret = this.config.getAppSecret();
    // onModuleInit guarantees this, but guard anyway so a caller never encrypts
    // with an empty passphrase.
    if (!secret) throw new Error('core.errors.appSecretUnavailable');
    return secret;
  }

  encrypt(plain: string): string {
    return encryptSecret(plain, this.secret());
  }

  decrypt(payload: string): string | null {
    return decryptSecret(payload, this.secret());
  }

  // Whether a stored value is already one of our ciphertexts (vs. legacy
  // plaintext). Used by the one-time startup migration.
  isEncrypted(value: string): boolean {
    return isEncrypted(value);
  }
}
