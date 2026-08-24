import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService, PluginI18nService } from '@makekeeper/backend-core';

// Thin JWT layer: sign/verify with the secret from AppConfigService. Secret
// and TTL are passed per call (not via JwtModule.register) so a rotated env
// var only needs a process restart, and so a missing secret degrades to a
// clean 503 instead of signing with a weak default.
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'makekeeper';

// Decoded token identity. `tokenVersion` is compared to the user row so a
// stale token (logout / password reset bumped the row) is rejected (#241); a
// token minted before the claim existed reads as version 0, matching a user
// whose version has never been bumped.
export interface VerifiedToken {
  userId: string;
  tokenVersion: number;
}

// The epoch invariant in one place so the HTTP guard, the socket handshake and
// the status resolver cannot drift: a decoded token is current only while its
// version still matches the user row (#241).
export function tokenEpochMatches(
  user: { tokenVersion: number },
  decoded: VerifiedToken,
): boolean {
  return user.tokenVersion === decoded.tokenVersion;
}

@Injectable()
export class AuthTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly i18n: PluginI18nService,
  ) {}

  hasUsableSecret(): boolean {
    return this.config.getJwtSecret() !== null;
  }

  sign(userId: string, tokenVersion: number, locale?: string): string {
    const secret = this.requireSecret(locale);
    return this.jwt.sign(
      { sub: userId, tv: tokenVersion },
      {
        secret,
        expiresIn: this.config.getJwtTtlSeconds(),
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
      },
    );
  }

  // Decodes the identity, or null for any invalid/expired/foreign token. The
  // caller compares `tokenVersion` against the live user row — this layer holds
  // no DB access. The accepted algorithm and issuer are pinned so a token
  // minted for a different purpose (or with a swapped alg) never verifies here.
  verify(token: string): VerifiedToken | null {
    const secret = this.config.getJwtSecret();
    if (!secret) return null;
    try {
      const payload: unknown = this.jwt.verify(token, {
        secret,
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
      });
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'sub' in payload &&
        typeof payload.sub === 'string'
      ) {
        const tv =
          'tv' in payload && typeof payload.tv === 'number' ? payload.tv : 0;
        return { userId: payload.sub, tokenVersion: tv };
      }
      return null;
    } catch {
      return null;
    }
  }

  private requireSecret(locale?: string): string {
    const secret = this.config.getJwtSecret();
    if (!secret) {
      throw new ServiceUnavailableException(
        this.i18n.t('multiuser.errors.jwtSecretMissing', undefined, locale),
      );
    }
    return secret;
  }
}
