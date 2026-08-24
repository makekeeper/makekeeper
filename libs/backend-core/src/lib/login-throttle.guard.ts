import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PluginI18nService } from './plugin-i18n.service';

// Per-IP throttle on the credential-bearing public endpoints (#237): the auth
// login/register/token routes and the device pairing-code redemption. These are
// anonymous, so an attacker can otherwise hammer them with a credential list at
// whatever rate the server sustains — bcrypt cost slows one instance but not a
// parallel run. This is a small in-memory fixed-window counter rather than a
// global throttler dependency: it guards exactly these routes and nothing else.
//
// Lives in the core (not the multiuser plugin) because the device pairing
// surface exists with the overlay off too, and one plugin must not import
// another's guard (§5.10).
//
// A legitimate user makes a handful of attempts a minute at most, so counting
// every attempt (successes included) and blocking over the limit never bites a
// real login; a brute-force run trips it quickly. The window is keyed on the
// client IP taken from Express's `req.ip`, which is derived under the bounded
// `trust proxy` set in main.ts (#237) — so behind the reverse proxy it is the
// real client and cannot be spoofed by a client-supplied X-Forwarded-For, and
// the socket address is the direct-exposure fallback.

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
// Bound the map: prune stale windows whenever it grows past this many keys, so a
// spray across many spoofed IPs cannot grow it without limit.
const PRUNE_THRESHOLD = 10_000;

interface AttemptWindow {
  count: number;
  resetAt: number;
}

interface ThrottleRequestLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
}

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly windows = new Map<string, AttemptWindow>();

  constructor(private readonly i18n: PluginI18nService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ThrottleRequestLike>();
    const locale = firstHeader(request.headers['x-locale']);
    const key = this.clientKey(request);
    const now = Date.now();

    if (this.windows.size > PRUNE_THRESHOLD) this.prune(now);

    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    window.count += 1;
    if (window.count > MAX_ATTEMPTS) {
      throw new HttpException(
        this.i18n.t('core.errors.tooManyAttempts', undefined, locale),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private clientKey(request: ThrottleRequestLike): string {
    // `req.ip` is Express-derived under the bounded `trust proxy` (main.ts), so
    // it is the real client even behind the reverse proxy and is not settable by
    // a client-supplied X-Forwarded-For. Socket address is the direct-exposure
    // fallback (no proxy in front). The 'unknown' bucket is deliberate: an
    // Express request always has one of the two, so it only ever collects
    // non-HTTP execution contexts — failing CLOSED (one shared bucket) beats
    // exempting anything that arrives unattributable.
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
