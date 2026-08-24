import { Injectable } from '@nestjs/common';

// The neutral seam between PrismaService and the (optional) multiuser overlay.
// PrismaService consults the holder on every model operation; when no policy
// is registered — the overlay absent or disabled at bootstrap — queries pass
// through untouched, so single-user behavior is preserved structurally.

// One intercepted Prisma model operation. `args` and `query` are type-erased:
// a catch-all interceptor cannot express Prisma's per-operation generics, and
// the policy rewrites args dynamically anyway (see CLAUDE.md §5.1 — dynamic
// values travel as `unknown`).
export interface DbQueryContext {
  // Prisma model name, e.g. "Project".
  readonly model: string;
  // Operation name, e.g. "findMany", "update".
  readonly operation: string;
  readonly args: unknown;
  readonly query: (args: unknown) => Promise<unknown>;
}

export interface DbAccessPolicy {
  run(ctx: DbQueryContext): Promise<unknown>;
}

@Injectable()
export class DbAccessPolicyHolder {
  private policy: DbAccessPolicy | null = null;

  register(policy: DbAccessPolicy): void {
    this.policy = policy;
  }

  get current(): DbAccessPolicy | null {
    return this.policy;
  }
}
