import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeviceTokenGuard } from './device-token.guard';
import type { DeviceAuthService } from './device-auth.service';
import type { PluginConfigService } from './plugin-config.service';
import type { PluginI18nService } from './plugin-i18n.service';
import type { RequestContextService } from './request-context.service';

// Revoking a phone has to bite even in single-user mode (#199), where nothing
// else looks at credentials at all.

const contextWith = (headers: Record<string, string>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

const build = (options: {
  multiuserEnabled: boolean;
  resolves?: boolean;
  isPublicRoute?: boolean;
}) => {
  const assign = jest.fn();
  const resolveToken = jest
    .fn()
    .mockResolvedValue(
      options.resolves === false ? null : { deviceId: 'd1', userId: null },
    );
  const guard = new DeviceTokenGuard(
    {
      getAllAndOverride: () => options.isPublicRoute ?? undefined,
    } as unknown as Reflector,
    {
      isEnabled: () => options.multiuserEnabled,
    } as unknown as PluginConfigService,
    { resolveToken } as unknown as DeviceAuthService,
    { t: (key: string) => key } as unknown as PluginI18nService,
    { assign } as unknown as RequestContextService,
  );
  return { guard, resolveToken, assign };
};

describe('DeviceTokenGuard', () => {
  it('admits an unauthenticated request, which is what single-user mode is', async () => {
    const { guard, resolveToken } = build({ multiuserEnabled: false });
    await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it('admits a live device token', async () => {
    const { guard } = build({ multiuserEnabled: false });
    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer live' })),
    ).resolves.toBe(true);
  });

  it('refuses a revoked or unknown token, so unpairing takes effect at once', async () => {
    const { guard } = build({ multiuserEnabled: false, resolves: false });
    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer revoked' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // A public route authenticates by other means (a session token in the URL, a
  // one-time pairing code) and must never fail on a credential it did not ask
  // for — this is what threw a phone with a revoked device off the phone-bridge
  // scan page.
  it('admits a @Public route even when the presented token is dead', async () => {
    const { guard, resolveToken } = build({
      multiuserEnabled: false,
      resolves: false,
      isPublicRoute: true,
    });
    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer revoked' })),
    ).resolves.toBe(true);
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it('stands aside while the overlay is on — that guard owns authentication', async () => {
    const { guard, resolveToken } = build({
      multiuserEnabled: true,
      resolves: false,
    });
    // A JWT would not resolve as a device token; consulting us at all would 401
    // every logged-in browser.
    await expect(
      guard.canActivate(contextWith({ authorization: 'Bearer jwt' })),
    ).resolves.toBe(true);
    expect(resolveToken).not.toHaveBeenCalled();
  });
});
