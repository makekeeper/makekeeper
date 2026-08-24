import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { LoginThrottleGuard } from './login-throttle.guard';
import type { PluginI18nService } from './plugin-i18n.service';

// The guard keys on Express's `req.ip` (populated under the bounded trust-proxy
// set in main.ts), so the tests drive that, not a raw header.
const ctxFor = (ip: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ip }) }),
  }) as unknown as ExecutionContext;

const i18n = { t: (k: string) => k } as unknown as PluginI18nService;

describe('LoginThrottleGuard (#237)', () => {
  it('allows attempts up to the limit then 429s further ones from the same IP', () => {
    const guard = new LoginThrottleGuard(i18n);
    const ctx = ctxFor('203.0.113.5');
    // 10 allowed, the 11th trips.
    for (let i = 0; i < 10; i++) expect(guard.canActivate(ctx)).toBe(true);
    let thrown: unknown;
    try {
      guard.canActivate(ctx);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(429);
  });

  it('counts each client IP independently', () => {
    const guard = new LoginThrottleGuard(i18n);
    const a = ctxFor('203.0.113.1');
    const b = ctxFor('203.0.113.2');
    for (let i = 0; i < 10; i++) guard.canActivate(a);
    // B is untouched by A hitting its limit.
    expect(guard.canActivate(b)).toBe(true);
  });

  it('falls back to the socket address when req.ip is absent', () => {
    const guard = new LoginThrottleGuard(i18n);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          socket: { remoteAddress: '198.51.100.7' },
        }),
      }),
    } as unknown as ExecutionContext;
    for (let i = 0; i < 10; i++) guard.canActivate(ctx);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });
});
