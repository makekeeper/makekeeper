import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ModelConstraintMap,
  ScopeAccess,
} from '@makekeeper/plugin-contract';

// Per-request context shared across the whole call chain (controllers,
// services, the Prisma access policy, agent tool handlers) without threading
// parameters through every signature. Populated by the multiuser overlay's
// guard when that plugin is enabled; stays empty otherwise, which every
// consumer must treat as "no restrictions" — that is what keeps the overlay
// optional.
// Why scope enforcement is suspended for a stretch of work. Every bypass names
// its reason so the sanctioned exceptions are greppable and distinct from an
// accidental one — a boolean said "bypassed" without saying why.
export type SystemBypassReason =
  | 'public-code-deeplink' // codes: public /c/<code> + phone-scan resolve
  | 'exchange' // exchange: whole-instance export / import dump
  | 'admin-cross-user' // multiuser: an admin acting across users' data
  | 'backfill' // multiuser: claim orphaned pre-overlay rows
  | 'restriction-descriptors' // multiuser: resolve the caller's own pick-lists
  | 'stats-aggregation' // stats/inventory: nightly all-scope rollup jobs
  | 'scheduler-tick' // schedule: the minute tick, which reads every scope's due rows before entering each owner's own
  | 'device-revoked'; // notify: drop a revoked device's push rows — an admin may revoke a device that is not in their own scope

export interface RequestContextData {
  userId?: string;
  isAdmin?: boolean;
  // Active scope (== owning user's id). Unset ⇒ no scoping applies.
  scopeId?: string;
  accessLevel?: ScopeAccess;
  // Effective plugin set for this user/scope. Unset ⇒ no per-user gating.
  enabledPluginIds?: ReadonlySet<string>;
  // Grant resource restrictions, already translated to per-model fragments.
  modelConstraints?: ModelConstraintMap[];
  // When set the DB access policy passes queries through untouched, and the
  // value records WHY (trusted internal reads: admin summaries, public
  // deep-links, background rollups, the policy's own pre-checks).
  systemBypassReason?: SystemBypassReason;
  locale?: string;
  // The paired device this request authenticated with, when it did (#311). Set
  // by whichever guard resolved the device token; absent for a browser session,
  // which is not a device anything can be revoked from.
  deviceId?: string;
  // IANA zone the caller's clock is in, as their browser reports it. Anything
  // that turns a wall-clock time into an instant needs it, and the server's own
  // zone is not an answer: it is wherever the instance happens to run.
  timezone?: string;
}

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContextData>();

  // Establish a context for the duration of `fn` (one HTTP request).
  run<T>(data: RequestContextData, fn: () => T): T {
    return this.als.run(data, fn);
  }

  get(): RequestContextData | undefined {
    return this.als.getStore();
  }

  // Mutate the live store in place — used by the guard, which runs after the
  // middleware already entered the context.
  assign(partial: Partial<RequestContextData>): void {
    const store = this.als.getStore();
    if (store) Object.assign(store, partial);
  }

  // Run `fn` with scope enforcement suspended, naming WHY. Uses a shallow COPY
  // of the store, so `assign` calls inside do not leak back into the request
  // context.
  runWithoutScope<T>(
    reason: SystemBypassReason,
    fn: () => Promise<T>,
  ): Promise<T> {
    const store = this.als.getStore();
    if (!store) return fn();
    return this.als.run({ ...store, systemBypassReason: reason }, fn);
  }

  // Run `fn` as the sole owner of `scopeId`: the access policy stays ACTIVE
  // (unlike runWithoutScope) but is retargeted at that scope, with the target
  // set as both scope and user so scope-bound AND user-bound rows resolve to
  // it, and with grant restrictions cleared (a full-owner read, not a shared
  // grantee's narrowed view). Used by admin-gated cross-user work — e.g.
  // exporting one user's data — where the caller is not that user. Runs on a
  // shallow COPY so nothing leaks back into the outer request context.
  runWithScope<T>(scopeId: string, fn: () => Promise<T>): Promise<T> {
    const store = this.als.getStore() ?? {};
    return this.als.run(
      {
        ...store,
        scopeId,
        userId: scopeId,
        accessLevel: 'OWNER',
        modelConstraints: undefined,
        systemBypassReason: undefined,
      },
      fn,
    );
  }
}
