import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  PrismaTransactionClient,
  RequestContextService,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { DIRECT_SCOPED_MODELS } from './scope-model-map';

// The delegates claimOrphans touches — satisfied by both the transaction
// client (first-admin registration) and the live PrismaService (onEnabled
// lifecycle hook).
type OrphanClaimClient = Pick<
  PrismaTransactionClient,
  | 'project'
  | 'projectGroup'
  | 'component'
  | 'order'
  | 'supplier'
  | 'storage'
  | 'stockMovement'
  | 'aIChatSession'
  | 'attachment'
  | 'tag'
  | 'tagLink'
  | 'tagSource'
  | 'itemCategory'
>;

// A by-name updateMany, shared by both client shapes. Same sanctioned
// type-erasure boundary as PrismaService.findFirstDynamic: a catch-all delegate
// lookup cannot express Prisma's per-model updateMany generics.
type UpdateManyDelegate = {
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
};

// Extra WHERE (beyond `scopeId: null`) for specific models. Phone-bridge
// attachments are transient (TTL-collected) and belong to their bridge
// session, not a user scope, so they stay unclaimed.
const CLAIM_WHERE_OVERRIDES: Record<string, Record<string, unknown>> = {
  Attachment: { bridgeSessionId: null },
};

// Extra columns (beyond `scopeId`) a claim sets. An orphan predates multi-user
// mode, so the admin claiming it is also the only person who can have uploaded
// it — recording that keeps attribution (#125) from starting out blank on every
// pre-existing file.
const CLAIM_DATA_OVERRIDES: Record<
  string,
  (adminId: string) => Record<string, unknown>
> = {
  Attachment: (adminId) => ({ uploadedByUserId: adminId }),
};

// Assigns ownerless rows (scopeId NULL — created while multi-user mode was
// off) to an admin's scope. Runs at first-admin registration and again on
// every disabled→enabled transition of the plugin, so data created during an
// "off" period is never stranded invisible.
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  // Claim under a system-bypass frame: the caller may be a scoped request (an
  // admin flipping the plugin on), and the scope policy would otherwise
  // rewrite `scopeId: null` filters into the caller's own scope.
  async claimOrphans(
    client: OrphanClaimClient,
    adminId: string,
  ): Promise<void> {
    await this.requestContext.runWithoutScope('backfill', async () => {
      const delegates = client as unknown as Record<
        string,
        UpdateManyDelegate | undefined
      >;
      // Derive the claimed set from the single scoped-model registry, so a new
      // direct-scoped model is backfilled automatically — no second list to
      // keep in lockstep.
      for (const model of DIRECT_SCOPED_MODELS) {
        const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
        const delegate = delegates[delegateName];
        if (!delegate) throw new Error('core.errors.unknownModel');
        await delegate.updateMany({
          where: { scopeId: null, ...CLAIM_WHERE_OVERRIDES[model] },
          data: { scopeId: adminId, ...CLAIM_DATA_OVERRIDES[model]?.(adminId) },
        });
      }
    });
  }

  // onEnabled lifecycle hook body: claim for the oldest admin. No-op when no
  // users exist yet — the first registration performs the claim instead.
  async claimOrphansForOldestAdmin(): Promise<void> {
    try {
      const admin = await this.prisma.user.findFirst({
        where: { isAdmin: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!admin) return;
      await this.claimOrphans(this.prisma, admin.id);
    } catch (error) {
      this.logger.error(`Orphan backfill failed: ${getErrorMessage(error)}`);
    }
  }
}
