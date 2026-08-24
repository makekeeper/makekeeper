import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  DbAccessPolicy,
  DbQueryContext,
  PluginI18nService,
  PrismaService,
  RequestContextData,
  RequestContextService,
} from '@makekeeper/backend-core';
import { ModelWhereFragment } from '@makekeeper/plugin-contract';
import {
  ConditionalScopedModelRule as ConditionalRule,
  resolveModelScopeRule,
  ScopedModelRule,
} from './scope-model-map';

// Operations whose args carry a `where` that can simply be AND-merged with the
// scope filters.
const WHERE_MERGE_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

const MUTATING_OPERATIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The two owners a row can have on this request. They are the SAME value
// outside a shared scope (a scope id IS a user id), which is why the whole
// conditional split collapses to the old behaviour in a single-user install.
interface ScopeOwners {
  // The scope being browsed — who shared data belongs to.
  scope: string;
  // The caller — who parentless, private data belongs to.
  user: string;
}

// The DB half of the multiuser "proxy": intercepts every Prisma model
// operation (registered into DbAccessPolicyHolder at bootstrap) and confines
// it to the request's active scope — WHERE-injection on reads, scopeId
// stamping and parent-ownership checks on writes, hard rejection of writes
// under READ grants. With no scope in the request context (plugin disabled,
// public routes, background jobs) everything passes through untouched.
@Injectable()
export class ScopePolicyService implements DbAccessPolicy {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
  ) {}

  async run(ctx: DbQueryContext): Promise<unknown> {
    const rc = this.requestContext.get();
    const rule = resolveModelScopeRule(ctx.model);
    // `unscoped` (system/infra models) and an unrecognized model both pass
    // through untouched, exactly as an absent map entry did before.
    if (
      !rc?.scopeId ||
      rc.systemBypassReason ||
      !rule ||
      rule.kind === 'unscoped'
    ) {
      return ctx.query(ctx.args);
    }

    // User-bound rows (chats) belong to their creator regardless of the active
    // scope; scope-bound rows belong to the scope being browsed. A conditional
    // model is both, decided per row by whether it has a parent — see
    // `buildFilters`.
    const userBound = rule.binding === 'user';
    const owners: ScopeOwners = {
      scope: rc.scopeId,
      user: rc.userId ?? rc.scopeId,
    };
    const ownerId = userBound ? owners.user : owners.scope;

    // A READ grant freezes the shared scope's data — but the caller's own
    // private rows stay writable: chatting in a read-only scope is fine. For a
    // conditional model that means the parentless half only, so the mutation is
    // not refused outright, it is CONFINED to it.
    const privateHalfOnly = this.assertWritableUnderRead(rule, ctx, rc);
    const filters = this.buildFilters(
      ctx.model,
      rule,
      owners,
      rc,
      privateHalfOnly,
    );

    if (WHERE_MERGE_OPERATIONS.has(ctx.operation)) {
      // The bulk write path merges scope filters into `where`, confining WHICH
      // rows are touched — but `data` is unchecked. A `data.scopeId` would then
      // re-home the matched rows into another scope, so reject it here exactly
      // as the single-row `update` path does.
      if (ctx.operation === 'updateMany' && isRecord(ctx.args)) {
        this.assertScopeFieldUntouched(ctx.args.data, ownerId, rc);
        await this.prepareReparenting(rule, ctx.args.data, owners, rc);
      }
      return ctx.query(this.withMergedWhere(ctx.args, filters));
    }

    switch (ctx.operation) {
      // Unique lookups cannot take relation filters — rewrite through the
      // client as findFirst, which re-enters this policy and gets filtered.
      case 'findUnique':
      case 'findUniqueOrThrow': {
        const args = isRecord(ctx.args) ? ctx.args : {};
        const found = await this.prisma.findFirstDynamic(ctx.model, args);
        if (found === null && ctx.operation === 'findUniqueOrThrow') {
          throw new NotFoundException(
            this.i18n.t(
              'multiuser.errors.notFoundInScope',
              undefined,
              rc.locale,
            ),
          );
        }
        return found;
      }

      case 'create': {
        const args = this.requireRecord(ctx.args, rc);
        const data = this.requireRecord(args.data, rc);
        await this.prepareCreateData(ctx.model, rule, data, owners, rc);
        return ctx.query(args);
      }

      case 'createMany': {
        const args = this.requireRecord(ctx.args, rc);
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        for (const row of rows) {
          await this.prepareCreateData(
            ctx.model,
            rule,
            this.requireRecord(row, rc),
            owners,
            rc,
          );
        }
        return ctx.query(args);
      }

      case 'update':
      case 'delete': {
        const args = this.requireRecord(ctx.args, rc);
        if (ctx.operation === 'update') {
          this.assertScopeFieldUntouched(args.data, ownerId, rc);
        }
        const where = isRecord(args.where) ? args.where : {};
        const inScope = await this.prisma.findFirstDynamic(ctx.model, {
          where: { AND: [where, ...filters] },
        });
        if (inScope === null) {
          throw new NotFoundException(
            this.i18n.t(
              'multiuser.errors.notFoundInScope',
              undefined,
              rc.locale,
            ),
          );
        }
        // Re-parenting is re-homing: a file moved into a project becomes the
        // project's. Done after the visibility pre-check so a row the caller
        // cannot see is never restamped.
        if (ctx.operation === 'update') {
          await this.prepareReparenting(rule, args.data, owners, rc);
        }
        return ctx.query(args);
      }

      // No scoped-model upserts exist in this repo; failing loud beats
      // silently writing into the wrong scope if one ever appears.
      case 'upsert':
      default:
        throw new InternalServerErrorException(
          this.i18n.t(
            'multiuser.errors.unsupportedOperation',
            undefined,
            rc.locale,
          ),
        );
    }
  }

  private buildFilters(
    model: string,
    rule: ScopedModelRule,
    owners: ScopeOwners,
    rc: RequestContextData,
    privateHalfOnly: boolean,
  ): ModelWhereFragment[] {
    // A conditional model is two tables in a trench coat, and the split is
    // owned HERE rather than by each plugin's restriction descriptor: the
    // private half is the caller's own parentless rows and is never narrowed by
    // a grant, the shared half is the scope's and is narrowed like any other
    // shared data. A descriptor therefore keeps announcing plain
    // "files of these projects" and cannot accidentally reach private rows.
    if (rule.binding === 'conditional') {
      const own: ModelWhereFragment = {
        AND: [this.parentlessWhere(rule), { scopeId: owners.user }],
      };
      if (privateHalfOnly) return [own];
      const shared: ModelWhereFragment = {
        AND: [
          this.parentedWhere(rule),
          { scopeId: owners.scope },
          ...this.restrictionFragments(model, rc),
        ],
      };
      return [{ OR: [own, shared] }];
    }

    const ownerId = rule.binding === 'user' ? owners.user : owners.scope;
    const filters: ModelWhereFragment[] = [
      rule.kind === 'direct' ? { scopeId: ownerId } : rule.scopeWhere(ownerId),
    ];
    // Grant restrictions narrow the owner's SHARED data; a user's private
    // (user-bound) rows are never subject to them.
    if (rule.binding !== 'user') {
      filters.push(...this.restrictionFragments(model, rc));
    }
    return filters;
  }

  private restrictionFragments(
    model: string,
    rc: RequestContextData,
  ): ModelWhereFragment[] {
    const fragments: ModelWhereFragment[] = [];
    for (const constraintMap of rc.modelConstraints ?? []) {
      const fragment = constraintMap[model];
      if (fragment) fragments.push(fragment);
    }
    return fragments;
  }

  // "Has nothing to belong to" — every ownership-conferring FK is null.
  private parentlessWhere(rule: ConditionalRule): ModelWhereFragment {
    return {
      AND: rule.parents.map((parent) => ({ [parent.foreignKeyField]: null })),
    };
  }

  // "Belongs to something" — the exact complement of the above.
  private parentedWhere(rule: ConditionalRule): ModelWhereFragment {
    return {
      OR: rule.parents.map((parent) => ({
        [parent.foreignKeyField]: { not: null },
      })),
    };
  }

  // Does this row's `data` give it a parent? Undefined keys are absent, not
  // null: on a create that means "no parent", on an update "leave it alone" —
  // which is why an update asks a stricter question (see `prepareReparenting`).
  private hasParentInData(
    rule: ConditionalRule,
    data: Record<string, unknown>,
  ): boolean {
    return rule.parents.some((parent) => data[parent.foreignKeyField] != null);
  }

  // The READ-grant gate. Returns whether the mutation must be confined to the
  // caller's private half; throws when it may not proceed at all.
  //
  // For a conditional model a READ grant does not forbid writing, it forbids
  // writing the SCOPE's data: the caller may still create, edit and delete
  // parentless rows of their own — but may not give one a parent, because that
  // hands the scope a file it did not have.
  private assertWritableUnderRead(
    rule: ScopedModelRule,
    ctx: DbQueryContext,
    rc: RequestContextData,
  ): boolean {
    if (rc.accessLevel !== 'READ' || !MUTATING_OPERATIONS.has(ctx.operation)) {
      return false;
    }
    if (rule.binding === 'user') return false;
    if (rule.binding !== 'conditional') {
      throw new ForbiddenException(
        this.i18n.t('multiuser.errors.readOnlyScope', undefined, rc.locale),
      );
    }
    const args = isRecord(ctx.args) ? ctx.args : {};
    const rows =
      ctx.operation === 'create' || ctx.operation === 'createMany'
        ? Array.isArray(args.data)
          ? args.data
          : [args.data]
        : [args.data];
    for (const row of rows) {
      if (isRecord(row) && this.hasParentInData(rule, row)) {
        throw new ForbiddenException(
          this.i18n.t('multiuser.errors.readOnlyScope', undefined, rc.locale),
        );
      }
    }
    return true;
  }

  private withMergedWhere(
    args: unknown,
    filters: ModelWhereFragment[],
  ): Record<string, unknown> {
    const base = isRecord(args) ? args : {};
    const where = isRecord(base.where) ? base.where : {};
    return { ...base, where: { AND: [where, ...filters] } };
  }

  // Direct models get the owner stamped (active scope, or the user itself for
  // user-bound rows); child models must prove every flat parent FK points at a
  // row the caller can see (checked through the policy itself, so grant
  // restrictions narrow the check too).
  private async prepareCreateData(
    model: string,
    rule: ScopedModelRule,
    data: Record<string, unknown>,
    owners: ScopeOwners,
    rc: RequestContextData,
  ): Promise<void> {
    if (rule.kind === 'direct') {
      // A conditional row is stamped by what it belongs to, not by which scope
      // happened to be open: a file filed under a project or a component gets
      // that scope, a file with nothing to belong to gets its uploader.
      const stamp =
        rule.binding === 'conditional'
          ? this.conditionalStamp(rule, data, owners)
          : rule.binding === 'user'
            ? owners.user
            : owners.scope;
      this.assertScopeFieldUntouched(data, stamp, rc);
      data.scopeId = stamp;
      // Direct models may carry nullable scope-bearing FKs (Component.storageId,
      // chat session / attachment projectId). Verify each supplied one is inside
      // the active scope so a stamped-in-scope row cannot reference — and later
      // leak through a relation read — another scope's parent.
      for (const parent of rule.parents ?? []) {
        const fkValue = data[parent.foreignKeyField];
        if (fkValue === undefined || fkValue === null) continue;
        await this.assertParentInScope(parent, fkValue, rc);
      }
      return;
    }
    // A child's parents are proven exactly as a direct model's are: only the
    // ones the create actually supplies. A NULLABLE parent FK is a real thing
    // since #130 — a chat turn taken with no project in scope writes
    // `AIChatMessage.projectId: null`, and there is nothing to prove about a
    // parent that was not named. Treating that as a refusal broke every
    // project-less turn in multi-user mode.
    //
    // No hole opens: a child whose parent FK is its ONLY proof declares that
    // column non-null (Task.projectId), so Prisma refuses the create before
    // this code could wave it through. What still fails loud is a non-string
    // value — a nested write, which is what this guard was really written for.
    for (const parent of rule.parents) {
      const fkValue = data[parent.foreignKeyField];
      if (fkValue === undefined || fkValue === null) continue;
      await this.assertParentInScope(parent, fkValue, rc);
    }
  }

  // Who a conditional row belongs to, read off the row itself.
  private conditionalStamp(
    rule: ConditionalRule,
    data: Record<string, unknown>,
    owners: ScopeOwners,
  ): string {
    return this.hasParentInData(rule, data) ? owners.scope : owners.user;
  }

  // Moving a row between parents moves it between owners, so `scopeId` is
  // recomputed here rather than by the caller — application code never sets
  // that column (`assertScopeFieldUntouched`), and a re-parenting that forgot
  // to would leave the row filed under its old owner and invisible to its new
  // one. The new parents are proven in-scope exactly as on create.
  private async prepareReparenting(
    rule: ScopedModelRule,
    data: unknown,
    owners: ScopeOwners,
    rc: RequestContextData,
  ): Promise<void> {
    if (rule.binding !== 'conditional' || !isRecord(data)) return;
    const touched = rule.parents.filter(
      (parent) => parent.foreignKeyField in data,
    );
    if (touched.length === 0) return;
    // The new owner is a property of the WHOLE row, so a partial re-parenting
    // ("set projectId, say nothing about componentId") cannot be answered from
    // `data` alone, and an updateMany has no single row to read it from. Fail
    // loud rather than stamp a guess.
    if (touched.length !== rule.parents.length) {
      throw new InternalServerErrorException(
        this.i18n.t(
          'multiuser.errors.partialReparenting',
          undefined,
          rc.locale,
        ),
      );
    }
    for (const parent of touched) {
      const fkValue = data[parent.foreignKeyField];
      if (fkValue === undefined || fkValue === null) continue;
      await this.assertParentInScope(parent, fkValue, rc);
    }
    data.scopeId = this.conditionalStamp(rule, data, owners);
  }

  // Proves a foreign key points at a row visible in the caller's active scope,
  // re-querying THROUGH the policy (so grant restrictions apply to the check).
  private async assertParentInScope(
    parent: { model: string; foreignKeyField: string },
    fkValue: unknown,
    rc: RequestContextData,
  ): Promise<void> {
    if (typeof fkValue !== 'string') {
      // Nested writes are not used in this repo — refuse rather than skip
      // the ownership check.
      throw new InternalServerErrorException(
        this.i18n.t(
          'multiuser.errors.unsupportedOperation',
          undefined,
          rc.locale,
        ),
      );
    }
    const found = await this.prisma.findFirstDynamic(parent.model, {
      where: { id: fkValue },
      select: { id: true },
    });
    if (found === null) {
      throw new NotFoundException(
        this.i18n.t('multiuser.errors.notFoundInScope', undefined, rc.locale),
      );
    }
  }

  // Application code never sets scopeId itself; a mismatching explicit value
  // would silently leak rows across scopes, so reject it.
  private assertScopeFieldUntouched(
    data: unknown,
    ownerId: string,
    rc: RequestContextData,
  ): void {
    if (isRecord(data) && 'scopeId' in data && data.scopeId !== ownerId) {
      throw new ForbiddenException(
        this.i18n.t(
          'multiuser.errors.scopeFieldImmutable',
          undefined,
          rc.locale,
        ),
      );
    }
  }

  private requireRecord(
    value: unknown,
    rc: RequestContextData,
  ): Record<string, unknown> {
    if (!isRecord(value)) {
      throw new InternalServerErrorException(
        this.i18n.t(
          'multiuser.errors.unsupportedOperation',
          undefined,
          rc.locale,
        ),
      );
    }
    return value;
  }
}
