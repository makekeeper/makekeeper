import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import {
  PluginI18nService,
  PrismaService,
  RequestContextService,
  SecretBoxService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import type {
  NotifyChannelCapability,
  RenderedNotification,
} from '@makekeeper/plugin-contract';

export const WEB_PUSH_CHANNEL_ID = 'web-push';

// A name for a subscription that the browser holding it can recognise, and
// nobody else can act on. The endpoint itself is a capability URL — anything
// that has it can push to that device — so it never leaves the server; its
// digest is enough for a browser to point at its own row and say "this one is
// me".
const fingerprintOf = (endpoint: string): string =>
  createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

// web-push reports HTTP failures as an error carrying the push service's status
// code. Narrowed with a guard rather than asserted (§5.1) — the library's error
// is `unknown` to us, and a cast would happily read a field off anything.
const statusCodeOf = (err: unknown): number | null => {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) {
    return null;
  }
  const status = err.statusCode;
  return typeof status === 'number' ? status : null;
};

// Gone for good, as opposed to merely failing: the browser dropped the
// subscription, and no number of retries will bring it back.
const isGoneStatus = (status: number | null): boolean =>
  status === 404 || status === 410;

const SETTINGS_ID = 'default';

// The channel that needs no third party (#311).
//
// Built in rather than external, because it needs the mobile shell's service
// worker: the push arrives at a worker this app registered, on a subscription
// this app's page created. Everything else about it is a channel like any
// other — it renders what it is given and reports failure by throwing.
//
// A subscription is per DEVICE, not per person: a phone and a laptop are two
// registrations, and a browser that revokes one must not silence the other.
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretBoxService,
    private readonly context: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  // The VAPID pair, generated once and kept for the life of the install:
  // regenerating it invalidates every subscription every browser holds, so it
  // happens exactly once, lazily, the first time somebody subscribes.
  async ensureKeys(): Promise<{ publicKey: string; privateKey: string }> {
    const existing = await this.prisma.pushSettings.findFirst({
      where: { id: SETTINGS_ID },
    });
    if (existing) {
      const privateKey = this.secrets.decrypt(existing.privateKeyEnc);
      if (privateKey) return { publicKey: existing.publicKey, privateKey };
      // Undecryptable: the instance key changed under us. A new pair is the
      // only way forward, and every browser will re-subscribe on next visit.
      this.logger.warn(
        'VAPID key could not be decrypted; generating a new pair.',
      );
    }
    const generated = webpush.generateVAPIDKeys();
    const data = {
      publicKey: generated.publicKey,
      privateKeyEnc: this.secrets.encrypt(generated.privateKey),
      // RFC 8292 wants a contact; a mailto is what push services expect and
      // this one names the install, not a person.
      subject: 'mailto:notifications@makekeeper.local',
    };
    if (existing) {
      await this.prisma.pushSettings.update({
        where: { id: SETTINGS_ID },
        data,
      });
    } else {
      await this.prisma.pushSettings.create({
        data: { id: SETTINGS_ID, ...data },
      });
    }
    return { publicKey: generated.publicKey, privateKey: generated.privateKey };
  }

  async publicKey(): Promise<string> {
    return (await this.ensureKeys()).publicKey;
  }

  async subscribe(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    label?: string;
  }): Promise<void> {
    const ctx = this.context.get();
    const scopeId = ctx?.scopeId ?? null;
    // Only set when the request authenticated as a paired device (#311); a
    // subscription from an ordinary browser session belongs to no device.
    const deviceId = ctx?.deviceId ?? null;
    const existing = await this.prisma.pushSubscription.findFirst({
      where: { endpoint: input.endpoint },
    });
    if (existing) {
      // The same browser re-subscribing (keys rotate on their own schedule):
      // update in place rather than accumulating dead endpoints. `update`, not
      // `upsert` — the policy fails loud on an upsert against a scoped model.
      await this.prisma.pushSubscription.update({
        where: { id: existing.id },
        // The device is re-stated too: the same browser can re-subscribe after
        // being paired, and a subscription that predates the column earns its
        // device the first time that phone renews it.
        data: {
          p256dh: input.p256dh,
          auth: input.auth,
          label: input.label,
          deviceId,
        },
      });
      return;
    }
    await this.prisma.pushSubscription.create({
      data: {
        id: generateUuid(),
        scopeId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        label: input.label ?? null,
        deviceId,
      },
    });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  // Drop everything a revoked device was subscribed with (#311). Keyed by the
  // device alone, and deliberately outside the caller's scope: an admin may
  // revoke a device that belongs to somebody else, and scoped to the admin this
  // delete would match nothing and fail silently. The device id is itself the
  // authority — it names exactly one person's phone.
  async forgetDevice(deviceId: string): Promise<void> {
    await this.context.runWithoutScope('device-revoked', async () => {
      const { count } = await this.prisma.pushSubscription.deleteMany({
        where: { deviceId },
      });
      if (count > 0) {
        this.logger.log(
          `Dropped ${count} push subscription(s) of revoked device ${deviceId}`,
        );
      }
    });
  }

  async listForCaller(): Promise<
    {
      id: string;
      label: string | null;
      createdAt: string;
      fingerprint: string;
    }[]
  > {
    const rows = await this.prisma.pushSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      fingerprint: fingerprintOf(row.endpoint),
    }));
  }

  async removeById(id: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { id } });
  }

  asChannel(): NotifyChannelCapability {
    return {
      channelId: WEB_PUSH_CHANNEL_ID,
      labelKey: 'notify.channels.webPush',
      isLinked: async (userId) =>
        (await this.context.runWithoutScope('scheduler-tick', () =>
          this.prisma.pushSubscription.count({ where: { scopeId: userId } }),
        )) > 0,
      deliver: (message) => this.deliver(message),
    };
  }

  private async deliver(message: RenderedNotification): Promise<void> {
    const keys = await this.ensureKeys();
    const subscriptions = await this.context.runWithoutScope(
      'scheduler-tick',
      () =>
        this.prisma.pushSubscription.findMany({
          where: { scopeId: message.recipientUserId },
        }),
    );
    if (subscriptions.length === 0) {
      // Thrown text is text (§5.5): the delivery log shows it to a person.
      throw new Error(this.i18n.t('notify.push.errors.noSubscription'));
    }
    const settings = await this.prisma.pushSettings.findFirst({
      where: { id: SETTINGS_ID },
    });
    webpush.setVapidDetails(
      settings?.subject ?? 'mailto:notifications@makekeeper.local',
      keys.publicKey,
      keys.privateKey,
    );

    const payload = JSON.stringify({
      title: message.title,
      body: message.body ?? '',
      url: message.url,
      // Same tag for the same notification, so a second device shows one
      // banner rather than a stack.
      tag: message.notificationId,
    });

    let delivered = 0;
    let lastError: unknown = null;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        );
        delivered += 1;
      } catch (err) {
        lastError = err;
        // 404/410 mean the browser threw the subscription away — the endpoint
        // is dead for good, so drop it rather than retrying it forever.
        if (isGoneStatus(statusCodeOf(err))) {
          await this.context.runWithoutScope('scheduler-tick', () =>
            this.prisma.pushSubscription.deleteMany({
              where: { id: subscription.id },
            }),
          );
        }
      }
    }
    // One device reached is a delivery: a laptop that is asleep must not make
    // the phone's banner count as a failure.
    if (delivered === 0) {
      throw new Error(
        this.i18n.t('notify.push.errors.everyDeviceFailed', {
          detail: getErrorMessage(lastError),
        }),
      );
    }
  }
}
