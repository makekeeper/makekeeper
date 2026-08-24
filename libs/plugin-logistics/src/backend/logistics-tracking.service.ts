import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  LogisticsSettingsService,
  TrackingProvider,
} from './logistics-settings.service';
import {
  fetchTracking,
  fetchTrackingCredentials,
  testTrackingKey,
  testTrackingCredentials,
} from './tracking-provider';

// The poll wakes hourly and only refreshes orders whose lastTrackedAt is older
// than the configured interval, so changing the interval needs no reschedule.
const TICK_MS = 60 * 60 * 1000;

@Injectable()
export class LogisticsTrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogisticsTrackingService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly settings: LogisticsSettingsService,
  ) {}

  onModuleInit(): void {
    this.pollTimer = setInterval(() => {
      this.pollAll().catch((err) =>
        this.logger.error(`Tracking poll failed: ${getErrorMessage(err)}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async getEvents(orderId: string) {
    return this.prisma.trackingEvent.findMany({
      where: { orderId },
      orderBy: { eventTime: 'desc' },
    });
  }

  // Validates provider credentials (from the settings form, before saving) —
  // an API key or a login/password depending on the chosen auth mode.
  async testConnection(input: {
    provider: TrackingProvider;
    authMode: 'apikey' | 'credentials';
    apiKey?: string;
    login?: string;
    password?: string;
  }) {
    if (input.authMode === 'credentials') {
      return testTrackingCredentials(
        input.provider,
        input.login ?? '',
        input.password ?? '',
      );
    }
    return testTrackingKey(input.provider, input.apiKey ?? '');
  }

  // Polls the provider for one order, replaces its checkpoint list and advances
  // ORDERED → SHIPPED on movement. DELIVERED stays user-confirmed on purpose:
  // marking an order delivered receives stock, which must not hinge on a flaky
  // third-party signal. Returns whether anything changed.
  async refreshOrder(orderId: string): Promise<{ updated: boolean }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new Error(this.i18n.t('logistics.errors.orderNotFound'));
    if (!order.trackingNumber) return { updated: false };

    const cfg = await this.settings.getInternal();
    if (cfg.trackingProvider === 'none') return { updated: false };

    // Pick the auth path: a web-account login/password (17track) or an API key.
    const result =
      cfg.authMode === 'credentials'
        ? await fetchTrackingCredentials(
            cfg.trackingProvider,
            cfg.trackingLogin,
            cfg.trackingPassword,
            order.trackingNumber,
          )
        : cfg.trackingApiKey
          ? await fetchTracking(
              cfg.trackingProvider,
              cfg.trackingApiKey,
              order.trackingNumber,
            )
          : null;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { lastTrackedAt: new Date() },
    });
    if (!result) return { updated: false };

    // Replace the checkpoint list (flat-FK writes for the scope policy, §5.8).
    await this.prisma.trackingEvent.deleteMany({ where: { orderId } });
    for (const ev of result.events) {
      await this.prisma.trackingEvent.create({
        data: {
          id: generateUuid(),
          orderId,
          status: ev.status,
          location: ev.location,
          eventTime: ev.eventTime,
          raw: ev.raw,
        },
      });
    }

    let updated = result.events.length > 0;
    if (
      result.orderStatus === 'SHIPPED' &&
      (order.status === 'CART' || order.status === 'ORDERED')
    ) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'SHIPPED' },
      });
      updated = true;
    }
    return { updated };
  }

  // Background sweep across ALL orders (runs with no request scope, so the scope
  // policy is bypassed and it sees every user's orders — a system job).
  private async pollAll(): Promise<void> {
    const cfg = await this.settings.getInternal();
    const configured =
      cfg.authMode === 'credentials' ? cfg.hasCredentials : cfg.hasApiKey;
    if (
      !cfg.autoTrackEnabled ||
      cfg.trackingProvider === 'none' ||
      !configured
    ) {
      return;
    }

    const cutoff = new Date(
      Date.now() - cfg.pollIntervalHours * 60 * 60 * 1000,
    );
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['ORDERED', 'SHIPPED'] },
        NOT: { trackingNumber: '' },
        OR: [{ lastTrackedAt: null }, { lastTrackedAt: { lt: cutoff } }],
      },
      select: { id: true },
    });

    for (const { id } of orders) {
      try {
        await this.refreshOrder(id);
      } catch (err) {
        this.logger.error(
          `Tracking refresh failed for ${id}: ${getErrorMessage(err)}`,
        );
      }
    }
  }
}
