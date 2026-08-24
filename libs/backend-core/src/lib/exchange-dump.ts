import type { ExchangeSectionProvider } from './exchange-registry.service';
import type { PrismaService } from './prisma.service';

// Generic whole-table dump/restore provider for INSTANCE dataset sections
// (#62 full backup). Instance import preserves ids verbatim into a verified
// fresh instance, so a literal row copy is exactly right — each plugin passes
// the Prisma model delegates it owns and gets a section provider for free.
// Entity roots never use this: they remap ids and filter by root.

interface DynamicDelegate {
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
  count(): Promise<number>;
}

// The one sanctioned type-erasure boundary of this file (mirrors
// `PrismaService.findFirstDynamic`): a generic dump addresses delegates by
// name at runtime, which Prisma's generated types cannot express.
function delegateOf(client: unknown, model: string): DynamicDelegate {
  const delegates = client as Record<string, DynamicDelegate | undefined>;
  const delegate = delegates[model];
  if (!delegate) {
    // Programming error (model renamed / typo) — thrown as an i18n key per
    // the backend error convention.
    throw new Error('core.errors.unknownModel');
  }
  return delegate;
}

// Strip the discriminator; everything else is the row verbatim. Dates arrive
// as ISO strings after the JSON round-trip — Prisma accepts those for
// DateTime columns.
function rowData(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...record };
  delete copy['t'];
  return copy;
}

// A model entry: the delegate name, plus (for self-referencing tables like
// Storage) the column pointing at the parent row — import then creates
// parents before children regardless of dump order. `seededIdKey` marks a
// config table the app seeds at bootstrap (PluginConfig, AgentToolConfig):
// its rows restore via upsert on that key instead of create, and it does not
// count toward the fresh-instance precondition — seeded rows are sanctioned
// day-one state, not data.
export type DumpModel =
  | string
  | { name: string; parentKey?: string; seededIdKey?: string };

function modelName(model: DumpModel): string {
  return typeof model === 'string' ? model : model.name;
}

// Parent-first ordering for a self-referencing table (Kahn). Rows whose
// parent is missing from the set (or cyclic garbage) go last and surface as
// FK errors instead of silently reordering the world.
function parentFirst(
  rows: Record<string, unknown>[],
  parentKey: string,
): Record<string, unknown>[] {
  const byId = new Map<unknown, Record<string, unknown>>(
    rows.map((r) => [r['id'], r]),
  );
  const ordered: Record<string, unknown>[] = [];
  const placed = new Set<unknown>();
  let frontier = rows.filter(
    (r) => r[parentKey] == null || !byId.has(r[parentKey]),
  );
  while (frontier.length > 0) {
    for (const row of frontier) {
      ordered.push(row);
      placed.add(row['id']);
    }
    frontier = rows.filter(
      (r) => !placed.has(r['id']) && placed.has(r[parentKey]),
    );
  }
  for (const row of rows) if (!placed.has(row['id'])) ordered.push(row);
  return ordered;
}

export function createTableDumpProvider(options: {
  sectionKey: string;
  // Prisma delegate names, in FK-safe creation order (parents first).
  models: DumpModel[];
  prisma: PrismaService;
}): ExchangeSectionProvider {
  const { sectionKey, models, prisma } = options;
  return {
    sectionKey,

    async exportSection() {
      const records: Record<string, unknown>[] = [];
      for (const model of models) {
        const name = modelName(model);
        const rows = await delegateOf(prisma, name).findMany();
        for (const row of rows) records.push({ t: name, ...row });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter(
          (r): r is Record<string, unknown> =>
            typeof r === 'object' &&
            r !== null &&
            typeof (r as Record<string, unknown>)['t'] === 'string',
        ).length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const model of models) {
        const name = modelName(model);
        let rows = records.filter(
          (raw): raw is Record<string, unknown> =>
            typeof raw === 'object' &&
            raw !== null &&
            (raw as Record<string, unknown>)['t'] === name,
        );
        const parentKey =
          typeof model !== 'string' ? model.parentKey : undefined;
        const seededIdKey =
          typeof model !== 'string' ? model.seededIdKey : undefined;
        if (parentKey) {
          rows = parentFirst(rows.map(rowData), parentKey).map((r) => ({
            t: name,
            ...r,
          }));
        }
        for (const raw of rows) {
          const data = rowData(raw);
          if (seededIdKey && data[seededIdKey] !== undefined) {
            await delegateOf(ctx.tx, name).upsert({
              where: { [seededIdKey]: data[seededIdKey] },
              create: data,
              update: data,
            });
          } else {
            await delegateOf(ctx.tx, name).create({ data });
          }
          created += 1;
        }
      }
      return { created };
    },

    // Fresh-instance precondition input: the orchestrator sums this across
    // every enabled instance section (selected or not) and rejects the import
    // when anything is non-zero — the framework stays free of model names.
    async countExistingRows(tx) {
      let total = 0;
      for (const model of models) {
        if (typeof model !== 'string' && model.seededIdKey) continue;
        total += await delegateOf(tx, modelName(model)).count();
      }
      return total;
    },
  };
}
