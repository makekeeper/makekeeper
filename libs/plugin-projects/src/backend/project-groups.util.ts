import { createHash } from 'node:crypto';
import type { PrismaService } from '@makekeeper/backend-core';

// The scope's default ("General") group id, derived from the scope itself.
//
// There is no "scope created" event to hook — a scopeId IS a user id — so the
// default group is created lazily on first access. Deriving its id from the
// scope makes the PRIMARY KEY the race lock: two concurrent first requests
// produce the same id, the loser collides and re-reads. The migration that
// backfills existing scopes uses the same derivation
// (`md5('projectgroup:default:' || COALESCE(scopeId, ''))`), so a scope that
// already has its group is recognised instead of duplicated.
export function defaultProjectGroupId(scopeId: string | null): string {
  return createHash('md5')
    .update(`projectgroup:default:${scopeId ?? ''}`)
    .digest('hex');
}

// The minimum a caller needs to create the default group. Narrower than
// PrismaService so a transaction client satisfies it too.
export type ProjectGroupWriter = Pick<PrismaService, 'projectGroup'>;

// Prisma's unique-constraint code. Read off the error rather than imported from
// `@prisma/client` so this helper stays usable with a transaction client too.
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  return err.code === 'P2002';
}

// Returns the scope's default group id, creating the group when it is missing.
// Idempotent, and safe to call concurrently (see above). `name` is resolved by
// the caller through PluginI18nService — the group is renameable user data from
// the moment it exists.
export async function ensureDefaultProjectGroup(
  prisma: ProjectGroupWriter,
  scopeId: string | null,
  name: string,
): Promise<string> {
  const id = defaultProjectGroupId(scopeId);
  const existing = await prisma.projectGroup.findUnique({ where: { id } });
  if (existing) return id;
  try {
    await prisma.projectGroup.create({
      data: { id, name, isDefault: true, position: 0 },
    });
  } catch (err) {
    // Losing the race is the ONE failure this swallows: the winner already
    // wrote the row, and its id is the answer. Anything else (a dead
    // connection, a schema drift) must still reach the caller.
    if (!isUniqueViolation(err)) throw err;
  }
  return id;
}
