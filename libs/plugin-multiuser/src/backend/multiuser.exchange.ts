import {
  ExchangeSectionProvider,
  PrismaService,
  isExchangeRecord,
  readBoolean,
  readDate,
  readOptionalString,
  readString,
} from '@makekeeper/backend-core';

// Instance-backup section of the multiuser plugin (#62): accounts (password
// hashes included), scope grants, per-user plugin sets and the overlay
// settings. `sensitive` — travels only behind the include-secrets toggle.
//
// Import precondition: the target may hold AT MOST the bootstrap admin
// account. If an archive user shares that admin's username, the local row is
// REPLACED — its id becomes the archive id, so every scopeId in the restored
// tables keeps pointing at the right owner (the admin just re-logs-in).

export function createMultiuserExchangeProviders(
  prisma: PrismaService,
): ExchangeSectionProvider[] {
  const allProvider: ExchangeSectionProvider = {
    sectionKey: 'multiuser.all',

    async exportSection() {
      const records: Record<string, unknown>[] = [];
      for (const user of await prisma.user.findMany()) {
        records.push({
          t: 'user',
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          displayName: user.displayName,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt.toISOString(),
        });
      }
      for (const grant of await prisma.scopeGrant.findMany()) {
        records.push({
          t: 'scopeGrant',
          id: grant.id,
          ownerUserId: grant.ownerUserId,
          granteeUserId: grant.granteeUserId,
          accessLevel: grant.accessLevel,
          allowedPluginIds: grant.allowedPluginIds,
          resourceRestrictions: grant.resourceRestrictions,
        });
      }
      for (const config of await prisma.userPluginConfig.findMany()) {
        records.push({
          t: 'userPluginConfig',
          userId: config.userId,
          pluginId: config.pluginId,
          isEnabled: config.isEnabled,
        });
      }
      const settings = await prisma.multiuserSettings.findUnique({
        where: { id: 'default' },
      });
      if (settings) {
        records.push({
          t: 'multiuserSettings',
          allowRegistration: settings.allowRegistration,
        });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'user')).length,
      };
    },

    async importSection(records, ctx) {
      // The orchestrator's fresh-instance precondition (countExistingRows
      // below) already ran; at most the bootstrap admin account exists here.
      const existing = await ctx.tx.user.findMany();
      const bootstrap = existing[0] ?? null;
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'user')) continue;
        const id = readString(raw, 'id', 100);
        const username = readString(raw, 'username', 300);
        const passwordHash = readString(raw, 'passwordHash', 500);
        if (!id || !username || !passwordHash) continue;
        const data = {
          username,
          passwordHash,
          displayName: readOptionalString(raw, 'displayName', 300),
          isAdmin: readBoolean(raw, 'isAdmin', false),
          createdAt: readDate(raw, 'createdAt') ?? new Date(),
        };
        if (
          bootstrap &&
          bootstrap.username.toLowerCase() === username.toLowerCase()
        ) {
          // Merge by username: the archive account wins, its id included —
          // that keeps the archive's scopeIds coherent.
          await ctx.tx.user.update({
            where: { id: bootstrap.id },
            data: { ...data, id },
          });
        } else {
          await ctx.tx.user.create({ data: { id, ...data } });
        }
        created += 1;
      }
      for (const raw of records) {
        if (isExchangeRecord(raw, 'scopeGrant')) {
          const id = readString(raw, 'id', 100);
          const ownerUserId = readString(raw, 'ownerUserId', 100);
          const granteeUserId = readString(raw, 'granteeUserId', 100);
          if (!id || !ownerUserId || !granteeUserId) continue;
          await ctx.tx.scopeGrant.create({
            data: {
              id,
              ownerUserId,
              granteeUserId,
              accessLevel: readString(raw, 'accessLevel', 10) ?? 'READ',
              allowedPluginIds:
                readString(raw, 'allowedPluginIds', 10_000) ?? '[]',
              resourceRestrictions:
                readString(raw, 'resourceRestrictions', 100_000) ?? '{}',
            },
          });
          created += 1;
        } else if (isExchangeRecord(raw, 'userPluginConfig')) {
          const userId = readString(raw, 'userId', 100);
          const pluginId = readString(raw, 'pluginId', 100);
          if (!userId || !pluginId) continue;
          await ctx.tx.userPluginConfig.create({
            data: {
              userId,
              pluginId,
              isEnabled: readBoolean(raw, 'isEnabled', true),
            },
          });
          created += 1;
        } else if (isExchangeRecord(raw, 'multiuserSettings')) {
          await ctx.tx.multiuserSettings.upsert({
            where: { id: 'default' },
            create: {
              id: 'default',
              allowRegistration: readBoolean(raw, 'allowRegistration', true),
            },
            update: {
              allowRegistration: readBoolean(raw, 'allowRegistration', true),
            },
          });
          created += 1;
        }
      }
      return { created };
    },

    // The bootstrap admin account is sanctioned day-one state — anything
    // beyond it (a second account, any grant or per-user plugin row) makes
    // the target non-fresh.
    async countExistingRows(tx) {
      const [users, grants, configs] = await Promise.all([
        tx.user.count(),
        tx.scopeGrant.count(),
        tx.userPluginConfig.count(),
      ]);
      return Math.max(0, users - 1) + grants + configs;
    },
  };

  return [allProvider];
}
