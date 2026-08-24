import { JwtService } from '@nestjs/jwt';
import { ServiceUnavailableException } from '@nestjs/common';
import { AuthTokenService } from './auth-token.service';
import type {
  AppConfigService,
  PluginI18nService,
} from '@makekeeper/backend-core';

const SECRET = 'x'.repeat(48);

const makeService = (secret: string | null = SECRET): AuthTokenService => {
  const config = {
    getJwtSecret: () => secret,
    getJwtTtlSeconds: () => 3600,
  } as unknown as AppConfigService;
  const i18n = { t: (k: string) => k } as unknown as PluginI18nService;
  return new AuthTokenService(new JwtService({}), config, i18n);
};

describe('AuthTokenService — token epoch & pinning (#241)', () => {
  it('round-trips the user id and token version', () => {
    const svc = makeService();
    const token = svc.sign('user-1', 7);
    expect(svc.verify(token)).toEqual({ userId: 'user-1', tokenVersion: 7 });
  });

  it('rejects a token minted under a different secret', () => {
    const a = makeService(SECRET);
    const b = makeService('y'.repeat(48));
    expect(b.verify(a.sign('user-1', 0))).toBeNull();
  });

  it('rejects a token that carries no issuer (foreign / hand-rolled)', () => {
    const svc = makeService();
    // Same secret, but signed without the pinned issuer — must not verify.
    const foreign = new JwtService({}).sign(
      { sub: 'user-1' },
      { secret: SECRET },
    );
    expect(svc.verify(foreign)).toBeNull();
  });

  it('reads a legacy token with no tv claim as version 0', () => {
    const svc = makeService();
    const legacy = new JwtService({}).sign(
      { sub: 'user-1' },
      { secret: SECRET, issuer: 'makekeeper' },
    );
    expect(svc.verify(legacy)).toEqual({ userId: 'user-1', tokenVersion: 0 });
  });

  it('degrades to 503 on sign and null on verify when no secret is set', () => {
    const svc = makeService(null);
    expect(() => svc.sign('user-1', 0)).toThrow(ServiceUnavailableException);
    expect(svc.verify('anything')).toBeNull();
  });
});
