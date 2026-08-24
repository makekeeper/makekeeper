import { Test } from '@nestjs/testing';
import { PrismaService, RequestContextService } from '@makekeeper/backend-core';
import { BackfillService } from './backfill.service';
import { DIRECT_SCOPED_MODELS } from './scope-model-map';

describe('BackfillService.claimOrphans', () => {
  let service: BackfillService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BackfillService,
        RequestContextService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(BackfillService);
  });

  const delegateName = (model: string): string =>
    model.charAt(0).toLowerCase() + model.slice(1);

  it('claims orphans for every direct-scoped model, deriving the set from the registry', async () => {
    const client: Record<string, { updateMany: jest.Mock }> = {};
    for (const model of DIRECT_SCOPED_MODELS) {
      client[delegateName(model)] = {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
    }

    await service.claimOrphans(client as never, 'admin1');

    for (const model of DIRECT_SCOPED_MODELS) {
      expect(client[delegateName(model)].updateMany).toHaveBeenCalledTimes(1);
      const arg = client[delegateName(model)].updateMany.mock.calls[0][0];
      expect(arg.data.scopeId).toBe('admin1');
      expect(arg.where.scopeId).toBeNull();
    }
    // Phone-bridge attachments stay unclaimed (transient, session-owned).
    expect(client['attachment'].updateMany.mock.calls[0][0].where).toEqual({
      scopeId: null,
      bridgeSessionId: null,
    });
    // An orphan predates multi-user mode, so the claiming admin is also the
    // only person who can have uploaded it — attribution (#125) starts filled
    // in rather than blank on every pre-existing file.
    expect(client['attachment'].updateMany.mock.calls[0][0].data).toEqual({
      scopeId: 'admin1',
      uploadedByUserId: 'admin1',
    });
  });
});
