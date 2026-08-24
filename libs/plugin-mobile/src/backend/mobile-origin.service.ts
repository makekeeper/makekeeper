import { Injectable } from '@nestjs/common';
import {
  AppConfigService,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';
import { MobileSettingsService } from './mobile-settings.service';
import { isEphemeralHost, isLoopbackHost } from './mobile-origin';

// An address a phone can open, plus whether the tunnel behind it has only just
// come up (see `resolveForPhone`).
export interface PhoneAddress {
  url: string | null;
  freshlyStarted: boolean;
}

// THE one place that answers "what address should a phone be sent to".
//
// Before this existed the question was answered twice — once for the pairing QR
// and once for the installability verdict — and the two could disagree the
// moment a custom origin was configured. Everything that needs a phone-facing
// address goes through here.
//
// Precedence, first match wins:
//   1. `MOBILE_BASE_URL` — a deployment stated it declaratively; a hard override
//      that the UI shows read-only rather than pretending to own.
//   2. The origin configured in the UI. This is the everyday case.
//   3. `PUBLIC_BASE_URL` — how the instance as a whole is published.
//   4. The secure origin this very request arrived on.
//   5. A tunnel, brought up on demand — the last resort, and the only one on an
//      instance with no permanent address at all.
@Injectable()
export class MobileOriginService {
  constructor(
    private readonly config: AppConfigService,
    private readonly settings: MobileSettingsService,
  ) {}

  // Resolve without starting anything. Used where a missing address is an
  // acceptable answer (the verdict endpoint knows the origin from the request).
  async resolveConfigured(): Promise<string | null> {
    const stored = await this.settings.getStored();
    return (
      this.config.getMobileOriginOverride() ??
      stored.customOrigin ??
      this.config.getPublicBaseUrlOverride()
    );
  }

  // Resolve an address a phone can actually open, starting a tunnel if that is
  // what it takes. `startTunnel: false` keeps it read-only, for callers that
  // merely want to know whether pairing is possible.
  //
  // `freshlyStarted` travels with the answer because a tunnel that has JUST come
  // up is not reachable yet — its name takes seconds to propagate — and whoever
  // is about to paint a QR has to hold it for that long.
  async resolveForPhone(
    req: RequestHeadersLike,
    clientOrigin?: string,
    startTunnel = true,
  ): Promise<PhoneAddress> {
    const configured = await this.resolveConfigured();
    if (configured) return { url: configured, freshlyStarted: false };

    const secure = this.config.pickSecurePublicOrigin(clientOrigin, req);
    if (secure && !isEphemeralHost(stripScheme(secure))) {
      return { url: secure, freshlyStarted: false };
    }

    const tunnel = this.settings.tunnel();
    if (!tunnel) return { url: secure ?? null, freshlyStarted: false };

    if (!startTunnel) {
      const running = await tunnel.currentTunnelUrl();
      return { url: running ?? secure ?? null, freshlyStarted: false };
    }
    const started = await tunnel.ensureTunnel();
    if (started.url) return started;
    // Nothing running, but a tunnel that COULD run still means a phone can be
    // brought on — `canPair` asks about possibility, not about right now.
    return { url: secure ?? null, freshlyStarted: false };
  }

  // Can a phone be brought onto this instance at all? Either a real address
  // exists, or a tunnel is configured and able to produce one.
  async canPair(
    req: RequestHeadersLike,
    clientOrigin?: string,
  ): Promise<boolean> {
    const { url } = await this.resolveForPhone(req, clientOrigin, false);
    if (url && !isLoopbackHost(stripScheme(url))) return true;
    const tunnel = this.settings.tunnel();
    return tunnel !== null && (await tunnel.tunnelUsable());
  }
}

function stripScheme(origin: string): string {
  return origin.replace(/^https?:\/\//, '');
}
