import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  CORE_DEVICE_REVOKED_EVENT,
  type CoreDeviceRevokedEvent,
} from '@makekeeper/plugin-contract';
import { PrismaService } from './prisma.service';
import { PluginEventBusService } from './plugin-event-bus.service';
import { generateUuid } from './uuid';

// Long-lived credentials for paired phones (#199).
//
// Why this lives in the CORE and not in the multiuser plugin: with the overlay
// off an instance has no authentication at all, and the mobile surface is
// exactly the thing people publish at a public address. The device token is
// then the only lock on the door. With the overlay on, the token additionally
// carries the identity of the user who paired it, and the multiuser guard
// resolves it into the same request context a JWT produces — one authorization
// model, two credential shapes.
//
// The credential itself is a high-entropy random string, so a plain SHA-256 of
// it is the right store: there is nothing to brute-force, and a slow hash would
// only tax every request. The same reasoning as the external-plugin tokens.

// Pairing codes are typed by nobody — they travel inside a QR — so they are as
// long as the tokens. Short-lived: a screenshot is useless within minutes.
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

// `lastSeenAt` is UX, not security; writing it on every request would turn each
// read into a write. One update per this window is plenty to answer "is this
// phone still in use".
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

// A paired device that has not been seen for this long stops authenticating
// (#243): device tokens are revocation-only otherwise, and a phone that fell
// out of use (lost, wiped, replaced) should not stay a live credential forever.
// Generous on purpose — a device in any regular use never comes near it; the
// throttled `lastSeenAt` write above keeps the clock honest within minutes.
const DEVICE_IDLE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const mintSecret = (): string => randomBytes(32).toString('base64url');

// A paired device as shown to a human — never the credential.
export interface PairedDeviceInfo {
  id: string;
  name: string;
  userId: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

// Who a presented device token turns out to be.
export interface ResolvedDevice {
  deviceId: string;
  userId: string | null;
}

@Injectable()
export class DeviceAuthService {
  private readonly logger = new Logger(DeviceAuthService.name);
  private readonly activityListeners: ((deviceId: string) => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: PluginEventBusService,
  ) {}

  // Fired whenever a paired device is seen. The core deliberately holds no
  // opinion about what that means — the mobile plugin uses it to keep a tunnel
  // alive while a phone is working, which is a policy that has no business
  // living in shared infrastructure.
  onDeviceActivity(listener: (deviceId: string) => void): void {
    this.activityListeners.push(listener);
  }

  // Mint a one-time pairing code for the QR. `userId` is the caller's identity
  // when the overlay is on — the device inherits it — and null in single-user
  // mode.
  async issuePairingCode(
    userId: string | null,
    now: Date = new Date(),
  ): Promise<{ id: string; code: string; expiresAt: Date }> {
    const code = mintSecret();
    const id = generateUuid();
    const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
    await this.prisma.devicePairingCode.create({
      data: { id, codeHash: hash(code), userId, expiresAt },
    });
    return { id, code, expiresAt };
  }

  // Has this offer been taken up yet? The desktop asks while its QR is on
  // screen, so the dialog can close itself the moment the phone pairs instead of
  // leaving a live credential painted on a monitor.
  async isPairingCodeRedeemed(id: string): Promise<boolean> {
    const pairing = await this.prisma.devicePairingCode.findUnique({
      where: { id },
    });
    return pairing?.usedAt != null;
  }

  // Exchange a pairing code for a device token. Single-use: `usedAt` is stamped
  // in the same transaction that creates the device, so two phones racing on one
  // screenshot cannot both win.
  async redeemPairingCode(
    code: string,
    deviceName: string,
    now: Date = new Date(),
  ): Promise<{ token: string; device: PairedDeviceInfo } | null> {
    const codeHash = hash(code);
    const token = mintSecret();
    const deviceId = generateUuid();

    try {
      const device = await this.prisma.$transaction(async (tx) => {
        // The `usedAt: null` filter is the lock: the update matches at most once,
        // so a second redemption of the same code finds nothing.
        const claimed = await tx.devicePairingCode.updateMany({
          where: { codeHash, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count === 0) return null;
        const pairing = await tx.devicePairingCode.findUnique({
          where: { codeHash },
        });
        return tx.pairedDevice.create({
          data: {
            id: deviceId,
            tokenHash: hash(token),
            name: deviceName,
            userId: pairing?.userId ?? null,
          },
        });
      });
      if (!device) return null;
      return {
        token,
        device: {
          id: device.id,
          name: device.name,
          userId: device.userId,
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
        },
      };
    } catch (err) {
      this.logger.error(`Pairing failed: ${String(err)}`);
      return null;
    }
  }

  // Resolve a presented credential. Returns null for anything that is not a live
  // device token — a JWT, a revoked device, a guess — so callers can fall
  // through to their other credential shapes.
  async resolveToken(
    token: string,
    now: Date = new Date(),
  ): Promise<ResolvedDevice | null> {
    const device = await this.prisma.pairedDevice.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!device || device.revokedAt !== null) return null;

    // Idle expiry: a token idle past the window is dead, not merely stale. The
    // device stays listed (and revocable) — it just has to be paired again.
    const idleSince = device.lastSeenAt ?? device.createdAt;
    if (now.getTime() - idleSince.getTime() > DEVICE_IDLE_EXPIRY_MS) {
      return null;
    }

    if (
      device.lastSeenAt === null ||
      now.getTime() - device.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS
    ) {
      await this.prisma.pairedDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: now },
      });
    }
    for (const listener of this.activityListeners) {
      try {
        listener(device.id);
      } catch (err) {
        // A listener is a courtesy, never a reason to fail a request.
        this.logger.warn(`Device activity listener failed: ${String(err)}`);
      }
    }
    return { deviceId: device.id, userId: device.userId };
  }

  // Devices a caller may see: their own while the overlay is on, all of them in
  // single-user mode (where every device is the single user's).
  async list(userId: string | null): Promise<PairedDeviceInfo[]> {
    const devices = await this.prisma.pairedDevice.findMany({
      where: { revokedAt: null, ...(userId === null ? {} : { userId }) },
      orderBy: { createdAt: 'desc' },
    });
    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      userId: d.userId,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
    }));
  }

  // Revoke one device. Scoped to the caller while the overlay is on, so one user
  // cannot unpair another's phone. Returns whether anything was revoked.
  async revoke(
    deviceId: string,
    userId: string | null,
    now: Date = new Date(),
  ): Promise<boolean> {
    const where = {
      id: deviceId,
      revokedAt: null,
      ...(userId === null ? {} : { userId }),
    };
    // Read the owner before the stamp: the announcement below carries it, and
    // after the update the row no longer matches `revokedAt: null`.
    const target = await this.prisma.pairedDevice.findFirst({ where });
    if (!target) return false;

    const result = await this.prisma.pairedDevice.updateMany({
      where,
      data: { revokedAt: now },
    });
    // `revokedAt: null` in the filter makes this a compare-and-set: two revokes
    // racing each other produce one winner, so the announcement fires once.
    if (result.count === 0) return false;

    // The credential is dead as of the line above. What follows is cleanup of
    // what the device left elsewhere — notify drops its push subscriptions
    // (#311) — and the bus swallows a listener's failure, so a plugin that is
    // disabled or broken cannot make a revoke report failure.
    await this.events.emit<CoreDeviceRevokedEvent>(CORE_DEVICE_REVOKED_EVENT, {
      deviceId,
      userId: target.userId,
    });
    return true;
  }
}
