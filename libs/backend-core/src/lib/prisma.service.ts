import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { DbAccessPolicyHolder } from './db-access-policy';

// Why composition instead of `extends PrismaClient`: scope enforcement (the
// multiuser overlay) is a `$extends` query extension, and `$extends` returns a
// NEW client type a subclass cannot become. The service therefore wraps the
// extended client and re-exposes each model delegate through typed getters —
// every existing `prisma.<model>` call site keeps compiling against the
// policy-aware client, with no casts.
function buildClient(pool: Pool, holder: DbAccessPolicyHolder) {
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const policy = holder.current;
          if (!policy) return query(args);
          // The one sanctioned type-erasure boundary: a catch-all interceptor
          // cannot express Prisma's per-operation `args` generics, and the
          // policy rewrites args dynamically anyway.
          const erasedQuery = query as (queryArgs: unknown) => Promise<unknown>;
          return policy.run({ model, operation, args, query: erasedQuery });
        },
      },
    },
  });
}

type ExtendedClient = ReturnType<typeof buildClient>;

// The client handed to interactive-transaction callbacks. Derived from the
// extended client's own `$transaction` signature (Parameters<> resolves to the
// last overload — the interactive form), so it stays correct if Prisma's
// internal deny-list of tx-client members changes.
export type PrismaTransactionClient = Parameters<
  Parameters<ExtendedClient['$transaction']>[0]
>[0];

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;
  private readonly client: ExtendedClient;

  constructor(policyHolder: DbAccessPolicyHolder) {
    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgrespassword@localhost:5432/diy_inspector?schema=public';
    this.pool = new Pool({ connectionString });
    this.client = buildClient(this.pool, policyHolder);
  }

  get project(): ExtendedClient['project'] {
    return this.client.project;
  }
  get task(): ExtendedClient['task'] {
    return this.client.task;
  }
  get component(): ExtendedClient['component'] {
    return this.client.component;
  }
  get projectGroup(): ExtendedClient['projectGroup'] {
    return this.client.projectGroup;
  }
  get itemCategory(): ExtendedClient['itemCategory'] {
    return this.client.itemCategory;
  }
  get categoryProperty(): ExtendedClient['categoryProperty'] {
    return this.client.categoryProperty;
  }
  get componentPropertyValue(): ExtendedClient['componentPropertyValue'] {
    return this.client.componentPropertyValue;
  }
  get projectComponent(): ExtendedClient['projectComponent'] {
    return this.client.projectComponent;
  }
  get order(): ExtendedClient['order'] {
    return this.client.order;
  }
  get orderComponent(): ExtendedClient['orderComponent'] {
    return this.client.orderComponent;
  }
  get supplier(): ExtendedClient['supplier'] {
    return this.client.supplier;
  }
  get trackingEvent(): ExtendedClient['trackingEvent'] {
    return this.client.trackingEvent;
  }
  get returnRequest(): ExtendedClient['returnRequest'] {
    return this.client.returnRequest;
  }
  get logisticsSettings(): ExtendedClient['logisticsSettings'] {
    return this.client.logisticsSettings;
  }
  get aIProviderConfig(): ExtendedClient['aIProviderConfig'] {
    return this.client.aIProviderConfig;
  }
  get chatAttachmentSettings(): ExtendedClient['chatAttachmentSettings'] {
    return this.client.chatAttachmentSettings;
  }
  get aIChatSession(): ExtendedClient['aIChatSession'] {
    return this.client.aIChatSession;
  }
  get aIChatMessage(): ExtendedClient['aIChatMessage'] {
    return this.client.aIChatMessage;
  }
  get attachment(): ExtendedClient['attachment'] {
    return this.client.attachment;
  }
  get phoneBridgeSession(): ExtendedClient['phoneBridgeSession'] {
    return this.client.phoneBridgeSession;
  }
  get phoneBridgeSettings(): ExtendedClient['phoneBridgeSettings'] {
    return this.client.phoneBridgeSettings;
  }
  get updateCheckSettings(): ExtendedClient['updateCheckSettings'] {
    return this.client.updateCheckSettings;
  }
  get taskComponent(): ExtendedClient['taskComponent'] {
    return this.client.taskComponent;
  }
  get taskOrderDependency(): ExtendedClient['taskOrderDependency'] {
    return this.client.taskOrderDependency;
  }
  get stockMovement(): ExtendedClient['stockMovement'] {
    return this.client.stockMovement;
  }
  get statsDaily(): ExtendedClient['statsDaily'] {
    return this.client.statsDaily;
  }
  get activityEvent(): ExtendedClient['activityEvent'] {
    return this.client.activityEvent;
  }
  get aIUsageEvent(): ExtendedClient['aIUsageEvent'] {
    return this.client.aIUsageEvent;
  }
  get stockSnapshot(): ExtendedClient['stockSnapshot'] {
    return this.client.stockSnapshot;
  }
  get tag(): ExtendedClient['tag'] {
    return this.client.tag;
  }
  get tagLink(): ExtendedClient['tagLink'] {
    return this.client.tagLink;
  }
  get tagSource(): ExtendedClient['tagSource'] {
    return this.client.tagSource;
  }
  get label(): ExtendedClient['label'] {
    return this.client.label;
  }
  get storage(): ExtendedClient['storage'] {
    return this.client.storage;
  }
  get agentToolConfig(): ExtendedClient['agentToolConfig'] {
    return this.client.agentToolConfig;
  }
  get pluginConfig(): ExtendedClient['pluginConfig'] {
    return this.client.pluginConfig;
  }
  get externalPlugin(): ExtendedClient['externalPlugin'] {
    return this.client.externalPlugin;
  }
  get externalInstallToken(): ExtendedClient['externalInstallToken'] {
    return this.client.externalInstallToken;
  }
  get externalAccessToken(): ExtendedClient['externalAccessToken'] {
    return this.client.externalAccessToken;
  }
  get externalConnectionToken(): ExtendedClient['externalConnectionToken'] {
    return this.client.externalConnectionToken;
  }
  get externalEventDelivery(): ExtendedClient['externalEventDelivery'] {
    return this.client.externalEventDelivery;
  }
  get externalDeferredBlob(): ExtendedClient['externalDeferredBlob'] {
    return this.client.externalDeferredBlob;
  }
  get externalCandidate(): ExtendedClient['externalCandidate'] {
    return this.client.externalCandidate;
  }
  get externalSettings(): ExtendedClient['externalSettings'] {
    return this.client.externalSettings;
  }
  get mobileSettings(): ExtendedClient['mobileSettings'] {
    return this.client.mobileSettings;
  }
  get inventoryIntakeDraft(): ExtendedClient['inventoryIntakeDraft'] {
    return this.client.inventoryIntakeDraft;
  }
  get pairedDevice(): ExtendedClient['pairedDevice'] {
    return this.client.pairedDevice;
  }
  get devicePairingCode(): ExtendedClient['devicePairingCode'] {
    return this.client.devicePairingCode;
  }
  get user(): ExtendedClient['user'] {
    return this.client.user;
  }
  get scopeGrant(): ExtendedClient['scopeGrant'] {
    return this.client.scopeGrant;
  }
  get userPluginConfig(): ExtendedClient['userPluginConfig'] {
    return this.client.userPluginConfig;
  }
  get multiuserSettings(): ExtendedClient['multiuserSettings'] {
    return this.client.multiuserSettings;
  }
  get userKeyring(): ExtendedClient['userKeyring'] {
    return this.client.userKeyring;
  }
  get keySession(): ExtendedClient['keySession'] {
    return this.client.keySession;
  }
  get secretAccessLog(): ExtendedClient['secretAccessLog'] {
    return this.client.secretAccessLog;
  }

  // Interactive transactions only — the sole form used in this repo. The tx
  // client passes through the same query extension, so scope enforcement
  // applies inside transactions too.
  $transaction<R>(
    fn: (tx: PrismaTransactionClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R> {
    return this.client.$transaction(fn, options);
  }

  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> {
    return this.client.$queryRaw(query, ...values);
  }

  // Dynamic, type-erased findFirst for the (optional) access policy, which
  // addresses models by name at runtime (findUnique rewrites, parent-ownership
  // pre-checks). Runs through the query extension, so the policy's own filters
  // apply recursively. Same sanctioned erasure boundary as the extension hook.
  findFirstDynamic(
    model: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const delegates = this.client as unknown as Record<
      string,
      | { findFirst?: (args: Record<string, unknown>) => Promise<unknown> }
      | undefined
    >;
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
    const findFirst = delegates[delegateName]?.findFirst;
    if (!findFirst) {
      // Invariant breach (unknown model in the scope map) — thrown as an i18n
      // key per the backend error convention.
      throw new Error('core.errors.unknownModel');
    }
    return findFirst.call(delegates[delegateName], args);
  }

  // Dynamic, type-erased count for callers that address scoped models by name
  // (the admin directory's per-model aggregates). Runs through the query
  // extension like findFirstDynamic — same sanctioned erasure boundary.
  countDynamic(model: string, args: Record<string, unknown>): Promise<number> {
    const delegates = this.client as unknown as Record<
      string,
      { count?: (args: Record<string, unknown>) => Promise<number> } | undefined
    >;
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
    const count = delegates[delegateName]?.count;
    if (!count) {
      throw new Error('core.errors.unknownModel');
    }
    return count.call(delegates[delegateName], args);
  }

  // Dynamic, type-erased deleteMany for callers that address scoped models by
  // name (the admin's cascade user-delete). `client` defaults to the shared
  // client but accepts a `$transaction` client so a multi-model cascade commits
  // atomically. Same sanctioned erasure boundary as the helpers above.
  deleteManyDynamic(
    model: string,
    args: Record<string, unknown>,
    client: unknown = this.client,
  ): Promise<{ count: number }> {
    const delegates = client as Record<
      string,
      | {
          deleteMany?: (
            args: Record<string, unknown>,
          ) => Promise<{ count: number }>;
        }
      | undefined
    >;
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
    const deleteMany = delegates[delegateName]?.deleteMany;
    if (!deleteMany) {
      throw new Error('core.errors.unknownModel');
    }
    return deleteMany.call(delegates[delegateName], args);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
    await this.pool.end();
  }
}
