import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  AppConfigService,
  PluginI18nService,
  PrismaService,
  RealtimeService,
  RequestContextService,
} from '@makekeeper/backend-core';
import { ensureDefaultProjectGroup } from '@makekeeper/plugin-projects/backend';
import type { DemoClearResult, DemoStatus } from '@makekeeper/plugin-contract';
import {
  DEMO_ID_PREFIX,
  DEMO_TABLES,
  seedDemoData,
  type DemoSeedCounts,
} from './demo-dataset';

// The plugins whose screens the demo rows appear on — the audience of the
// realtime nudge after a clear, so open tabs empty out instead of showing rows
// that no longer exist.
const AFFECTED_PLUGINS = [
  'projects',
  'inventory',
  'storages',
  'logistics',
  'tags',
  'stats',
];

// Seeding writes ~250 rows in one transaction; the Prisma default of 5 s is
// tight on a cold container sharing a disk with a just-started Postgres.
const SEED_TRANSACTION_TIMEOUT_MS = 60_000;

// Ships a believable workshop into an EMPTY instance, and owns its removal
// (#339). Two invariants carry the whole feature:
//
//  1. It runs once, on a database that holds no user data. `seededAt` records
//     that it ran, so clearing the demo rows can never resurrect them on the
//     next boot — and an instance that already holds real data is never
//     touched, on any boot.
//  2. Every row it writes is id-prefixed `demo_`, which is what makes the
//     removal exact: a prefix delete over a fixed table list, nothing else.
@Injectable()
export class DemoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly i18n: PluginI18nService,
    private readonly realtime: RealtimeService,
    private readonly requestContext: RequestContextService,
  ) {}

  // Bootstrap, not module init: every plugin module has registered its i18n
  // bundle by now, and the seed resolves the projects plugin's group name.
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedIfFirstInstall();
    } catch (err) {
      // A failed demo seed must never keep the instance from starting.
      this.logger.warn(
        `demo seed skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getStatus(): Promise<DemoStatus> {
    const row = await this.prisma.demoDataSettings.findUnique({
      where: { id: 'default' },
    });
    return {
      active: Boolean(row?.seededAt && !row.clearedAt),
      seededAt: row?.seededAt?.toISOString() ?? null,
      clearedAt: row?.clearedAt?.toISOString() ?? null,
    };
  }

  // Removes every `demo_` row and nothing else, then stamps the removal so the
  // banner stays gone. Idempotent: a second call deletes nothing and still
  // reports the (already empty) counts.
  //
  // Runs with scope enforcement suspended, and that is load-bearing: the seed
  // writes at NULL scope (bootstrap has no request context), while an admin
  // calling this from inside their own scope is scoped. Without the bypass the
  // delete would match nothing, report a cheerful zero, and stamp the removal —
  // banner gone, demo rows still there, and `seededAt` blocking a re-seed.
  async clear(): Promise<DemoClearResult> {
    const removed = await this.requestContext.runWithoutScope(
      'demo-clear',
      async () => {
        let count = 0;
        for (const table of DEMO_TABLES) {
          const result = await this.prisma.deleteManyDynamic(table, {
            where: { id: { startsWith: DEMO_ID_PREFIX } },
          });
          count += result.count;
        }
        return count;
      },
    );
    await this.prisma.demoDataSettings.upsert({
      where: { id: 'default' },
      update: { clearedAt: new Date() },
      create: { id: 'default', clearedAt: new Date() },
    });
    this.realtime.emitDataChangedForScope(AFFECTED_PLUGINS, null);
    this.logger.log(`demo data cleared (${removed} rows)`);
    return { removed };
  }

  private async seedIfFirstInstall(): Promise<void> {
    if (!this.config.isDemoSeedEnabled()) return;
    const existing = await this.prisma.demoDataSettings.findUnique({
      where: { id: 'default' },
    });
    // Seeded once, cleared once, or explicitly declined — all of them mean the
    // decision has already been made for this instance.
    if (existing) return;
    if (!(await this.isEmptyInstance())) return;

    const counts = await this.seed();
    this.logger.log(
      `demo data seeded: ${counts.projects} projects, ${counts.items} items, ${counts.orders} orders`,
    );
  }

  // "Nothing has been created here yet." Deliberately counts the aggregates a
  // person creates, not the rows the app seeds for itself (plugin config,
  // settings singletons) — those exist on a fresh boot too.
  private async isEmptyInstance(): Promise<boolean> {
    const [projects, items, orders, storages, categories] = await Promise.all([
      this.prisma.project.count(),
      this.prisma.component.count(),
      this.prisma.order.count(),
      this.prisma.storage.count(),
      this.prisma.itemCategory.count(),
    ]);
    return projects + items + orders + storages + categories === 0;
  }

  private async seed(): Promise<DemoSeedCounts> {
    // Bootstrap runs outside any request, so there is no ambient scope: the
    // rows land unscoped, exactly like everything created before the multiuser
    // overlay is switched on, and BackfillService.claimOrphans hands them to
    // the first admin if it ever is.
    const scopeId = this.requestContext.get()?.scopeId ?? null;
    const groupId = await ensureDefaultProjectGroup(
      this.prisma,
      scopeId,
      this.i18n.t('projects.groups.defaultName'),
    );
    const counts = await this.prisma.$transaction(
      (tx) => seedDemoData(tx, { scopeId, groupId }),
      { timeout: SEED_TRANSACTION_TIMEOUT_MS },
    );
    await this.prisma.demoDataSettings.upsert({
      where: { id: 'default' },
      update: { seededAt: new Date() },
      create: { id: 'default', seededAt: new Date() },
    });
    return counts;
  }
}
