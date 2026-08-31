import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { DeviceAuthService } from './device-auth.service';
import { PluginConfigService } from './plugin-config.service';
import { PluginI18nService } from './plugin-i18n.service';
import { RequestContextService } from './request-context.service';

// Makes a paired device's credential mean something while the multiuser overlay
// is OFF (#199).
//
// With the overlay on, the multiuser guard already resolves a device token into
// the same request context a JWT produces, and this guard stands aside. With it
// off there is no guard at all — which is how a revoked phone kept working:
// nobody was looking at the token it presented.
//
// What this deliberately does NOT do is close the instance. A single-user
// instance authenticates nobody by design, and demanding a credential from the
// desktop would be a different product. It enforces the one thing that IS
// enforceable here: a Bearer token presented to this instance must be a LIVE
// device token. An unknown or revoked one is refused, so unpairing a lost phone
// takes effect on its very next request.
//
// The remaining gap is honest and worth naming: with the overlay off, an
// attacker who presents no credential at all is still treated as the owner,
// exactly as before. Closing that means requiring authentication for the whole
// single-user instance — a product decision, not a bug fix.
const MULTIUSER_PLUGIN_ID = 'multiuser';

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

interface IncomingRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly pluginConfig: PluginConfigService,
    private readonly devices: DeviceAuthService,
    private readonly i18n: PluginI18nService,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The overlay owns authentication when it is on, including device tokens.
    if (this.pluginConfig.isEnabled(MULTIUSER_PLUGIN_ID)) return true;

    // A @Public route authenticates by other means — a session token in the
    // URL, a one-time pairing code — and must never be failed by a credential
    // it did not ask for. Without this, a phone still holding a revoked device
    // token was thrown off the public phone-bridge scan page, which needs no
    // credential at all.
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<IncomingRequestLike>();
    const header = firstHeader(request.headers['authorization']);
    if (!header?.startsWith('Bearer ')) return true;

    const token = header.slice('Bearer '.length).trim();
    if (!token) return true;

    const device = await this.devices.resolveToken(token);
    if (!device) {
      throw new UnauthorizedException(
        this.i18n.t(
          'core.devices.errors.deviceRevoked',
          undefined,
          firstHeader(request.headers['x-locale']),
        ),
      );
    }
    // Remember WHICH device this is, so anything created on its behalf can be
    // torn down with it (#311 — a revoked device's push subscriptions).
    this.context.assign({ deviceId: device.deviceId });
    return true;
  }
}
