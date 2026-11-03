import { DeviceAuthService } from './device-auth.service';
import type { PrismaService } from './prisma.service';
import type { PluginEventBusService } from './plugin-event-bus.service';
import {
  RequestContextService,
  type SystemBypassReason,
} from './request-context.service';

// A bus that records what was announced, so a test can assert the revoke told
// anybody (#311) without wiring real listeners.
const emitted: Array<{ event: string; payload: unknown }> = [];
// The bypass reason in force when each announcement went out — the listener
// runs inside the emitter's context, so this is what notify would see.
const emittedUnder: Array<SystemBypassReason | undefined> = [];
let contextForEvents: RequestContextService | null = null;
const events = (): PluginEventBusService =>
  ({
    emit: async (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      emittedUnder.push(contextForEvents?.get()?.systemBypassReason);
    },
  }) as unknown as PluginEventBusService;

// One place that knows the constructor, so the next dependency is a one-line edit.
const makeService = (
  prisma: PrismaService,
  context: RequestContextService = new RequestContextService(),
): DeviceAuthService => new DeviceAuthService(prisma, events(), context);

beforeEach(() => {
  emitted.length = 0;
  emittedUnder.length = 0;
  contextForEvents = null;
});

// Device credentials (#199). The properties worth pinning are the ones a bug
// would make silently permissive: a code that can be redeemed twice, a revoked
// phone that still works, one user unpairing another's device.

interface PairingRow {
  codeHash: string;
  userId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
}

interface DeviceRow {
  id: string;
  tokenHash: string;
  name: string;
  userId: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

// An in-memory stand-in for the two tables. Small enough to be obvious, and it
// preserves the one behaviour the service leans on: `updateMany` reports how
// many rows its filter actually matched.
function fakePrisma(): {
  prisma: PrismaService;
  pairings: PairingRow[];
  devices: DeviceRow[];
} {
  const pairings: PairingRow[] = [];
  const devices: DeviceRow[] = [];

  const matchesPairing = (
    row: PairingRow,
    where: { codeHash?: string; usedAt?: null; expiresAt?: { gt: Date } },
  ): boolean =>
    (where.codeHash === undefined || row.codeHash === where.codeHash) &&
    (where.usedAt === undefined || row.usedAt === null) &&
    (where.expiresAt === undefined || row.expiresAt > where.expiresAt.gt);

  const client = {
    devicePairingCode: {
      create: ({ data }: { data: PairingRow }) => {
        pairings.push({ ...data, usedAt: null });
        return Promise.resolve(data);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: Parameters<typeof matchesPairing>[1];
        data: { usedAt: Date };
      }) => {
        const hit = pairings.filter((row) => matchesPairing(row, where));
        hit.forEach((row) => (row.usedAt = data.usedAt));
        return Promise.resolve({ count: hit.length });
      },
      findUnique: ({ where }: { where: { codeHash: string } }) =>
        Promise.resolve(
          pairings.find((row) => row.codeHash === where.codeHash) ?? null,
        ),
    },
    pairedDevice: {
      create: ({ data }: { data: Partial<DeviceRow> }) => {
        const row: DeviceRow = {
          createdAt: new Date(),
          lastSeenAt: null,
          revokedAt: null,
          ...(data as DeviceRow),
        };
        devices.push(row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          devices.find((row) => row.tokenHash === where.tokenHash) ?? null,
        ),
      findMany: ({ where }: { where: { userId?: string } }) =>
        Promise.resolve(
          devices.filter(
            (row) =>
              row.revokedAt === null &&
              (where.userId === undefined || row.userId === where.userId),
          ),
        ),
      // Same filter the revoke's `updateMany` uses — the service reads the row
      // first to learn its owner, and a stub that ignored the filter would let
      // one user's revoke of another's device look like it found something.
      findFirst: ({
        where,
      }: {
        where: { id: string; revokedAt: null; userId?: string };
      }) =>
        Promise.resolve(
          devices.find(
            (row) =>
              row.id === where.id &&
              row.revokedAt === null &&
              (where.userId === undefined || row.userId === where.userId),
          ) ?? null,
        ),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { lastSeenAt: Date };
      }) => {
        const row = devices.find((d) => d.id === where.id);
        if (row) row.lastSeenAt = data.lastSeenAt;
        return Promise.resolve(row);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; revokedAt: null; userId?: string };
        data: { revokedAt: Date };
      }) => {
        const hit = devices.filter(
          (row) =>
            row.id === where.id &&
            row.revokedAt === null &&
            (where.userId === undefined || row.userId === where.userId),
        );
        hit.forEach((row) => (row.revokedAt = data.revokedAt));
        return Promise.resolve({ count: hit.length });
      },
    },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(client),
  };

  return { prisma: client as unknown as PrismaService, pairings, devices };
}

describe('DeviceAuthService', () => {
  it('trades a fresh code for a working token', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);

    const { code } = await service.issuePairingCode('u1');
    const result = await service.redeemPairingCode(code, 'workshop phone');

    expect(result).not.toBeNull();
    expect(result?.device.name).toBe('workshop phone');
    await expect(service.resolveToken(result!.token)).resolves.toEqual({
      deviceId: result!.device.id,
      userId: 'u1',
    });
  });

  it('refuses a second redemption of the same code', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);

    const { code } = await service.issuePairingCode('u1');
    await service.redeemPairingCode(code, 'first');

    // The screenshot case: the same QR, a second phone.
    await expect(service.redeemPairingCode(code, 'second')).resolves.toBeNull();
  });

  it('refuses an expired code', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);

    const issuedAt = new Date('2026-07-31T10:00:00Z');
    const { code } = await service.issuePairingCode('u1', issuedAt);

    const muchLater = new Date('2026-07-31T11:00:00Z');
    await expect(
      service.redeemPairingCode(code, 'late phone', muchLater),
    ).resolves.toBeNull();
  });

  it('binds the device to the user who issued the code, and to nobody in single-user mode', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);

    const bound = await service.redeemPairingCode(
      (await service.issuePairingCode('u7')).code,
      'alice phone',
    );
    expect(bound?.device.userId).toBe('u7');

    const unbound = await service.redeemPairingCode(
      (await service.issuePairingCode(null)).code,
      'the phone',
    );
    expect(unbound?.device.userId).toBeNull();
  });

  it('stops resolving a revoked device', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);

    const paired = await service.redeemPairingCode(
      (await service.issuePairingCode('u1')).code,
      'lost phone',
    );
    await expect(service.revoke(paired!.device.id, 'u1')).resolves.toBe(true);

    await expect(service.resolveToken(paired!.token)).resolves.toBeNull();
    expect(await service.list('u1')).toEqual([]);
  });

  it('will not let one user revoke another user’s device', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);

    const paired = await service.redeemPairingCode(
      (await service.issuePairingCode('u1')).code,
      'alice phone',
    );
    await expect(service.revoke(paired!.device.id, 'u2')).resolves.toBe(false);
    await expect(service.resolveToken(paired!.token)).resolves.not.toBeNull();
    // A revoke that revoked nothing announces nothing.
    expect(emitted).toEqual([]);
  });

  // #311: the credential dying is only half of it — whatever the device left
  // running elsewhere (its push subscriptions) has to hear about it.
  it('announces a revoke once, and only when a device actually changed', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);
    const paired = await service.redeemPairingCode(
      (await service.issuePairingCode('u1')).code,
      'lost phone',
    );

    await expect(service.revoke(paired!.device.id, 'u1')).resolves.toBe(true);
    expect(emitted).toEqual([
      {
        event: 'core.device-revoked',
        payload: { deviceId: paired!.device.id, userId: 'u1' },
      },
    ]);

    // Revoking it again is a no-op, so nobody is told a second time.
    await expect(service.revoke(paired!.device.id, 'u1')).resolves.toBe(false);
    expect(emitted).toHaveLength(1);
  });

  it('returns null for a credential that is not a device token', async () => {
    const { prisma } = fakePrisma();
    const service = makeService(prisma);
    // A JWT arriving here must fall through, not throw — the guard tries both.
    await expect(
      service.resolveToken('header.payload.sig'),
    ).resolves.toBeNull();
  });

  // #330: idle expiry has to be an event, not just a refusal, or the dead
  // phone's push subscriptions never hear about it.
  describe('idle expiry sweep', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const pairedAt = new Date('2026-07-01T10:00:00Z');
    const daysLater = (days: number): Date =>
      new Date(pairedAt.getTime() + days * DAY_MS);

    async function pairOne(
      service: DeviceAuthService,
      devices: DeviceRow[],
      userId: string | null,
    ): Promise<{ token: string; row: DeviceRow }> {
      const paired = await service.redeemPairingCode(
        (await service.issuePairingCode(userId)).code,
        'phone',
      );
      const row = devices.find((d) => d.id === paired?.device.id);
      if (!paired || !row) throw new Error('pairing failed in fixture');
      row.createdAt = pairedAt;
      row.lastSeenAt = pairedAt;
      return { token: paired.token, row };
    }

    it('revokes a device idle past the window and announces it by id', async () => {
      const { prisma, devices } = fakePrisma();
      const context = new RequestContextService();
      contextForEvents = context;
      const service = makeService(prisma, context);
      const { token, row } = await pairOne(service, devices, 'u1');

      const now = daysLater(91);
      await expect(service.expireIdleDevices(now)).resolves.toBe(1);

      expect(row.revokedAt).toEqual(now);
      expect(emitted).toEqual([
        {
          event: 'core.device-revoked',
          payload: { deviceId: row.id, userId: 'u1' },
        },
      ]);
      // Listeners run outside any request; the sweep names why.
      expect(emittedUnder).toEqual(['device-idle-expiry']);
      // Dead everywhere, not only on the push list.
      await expect(service.resolveToken(token, now)).resolves.toBeNull();
      expect(await service.list('u1')).toEqual([]);
    });

    it('measures a never-seen device from when it was paired', async () => {
      const { prisma, devices } = fakePrisma();
      const service = makeService(prisma);
      const { row } = await pairOne(service, devices, null);
      row.lastSeenAt = null;

      await expect(service.expireIdleDevices(daysLater(91))).resolves.toBe(1);
      expect(emitted).toEqual([
        {
          event: 'core.device-revoked',
          payload: { deviceId: row.id, userId: null },
        },
      ]);
    });

    it('leaves a device inside the window alone', async () => {
      const { prisma, devices } = fakePrisma();
      const service = makeService(prisma);
      const { token, row } = await pairOne(service, devices, 'u1');
      row.lastSeenAt = daysLater(30);

      const now = daysLater(100);
      await expect(service.expireIdleDevices(now)).resolves.toBe(0);
      expect(row.revokedAt).toBeNull();
      expect(emitted).toEqual([]);
      await expect(service.resolveToken(token, now)).resolves.not.toBeNull();
    });

    it('agrees with resolveToken about where the window ends', async () => {
      const { prisma, devices } = fakePrisma();
      const service = makeService(prisma);
      const { token } = await pairOne(service, devices, 'u1');

      // Exactly on the line: still alive for both.
      const onTheLine = daysLater(90);
      await expect(service.expireIdleDevices(onTheLine)).resolves.toBe(0);
      await expect(
        service.resolveToken(token, onTheLine),
      ).resolves.not.toBeNull();
    });

    it('does not re-announce a device that was already revoked', async () => {
      const { prisma, devices } = fakePrisma();
      const service = makeService(prisma);
      const { row } = await pairOne(service, devices, 'u1');

      await expect(service.revoke(row.id, 'u1', daysLater(10))).resolves.toBe(
        true,
      );
      expect(emitted).toHaveLength(1);

      await expect(service.expireIdleDevices(daysLater(200))).resolves.toBe(0);
      expect(emitted).toHaveLength(1);
      // The manual revoke's stamp is the one that stands.
      expect(row.revokedAt).toEqual(daysLater(10));
    });

    it('announces once when two sweeps overlap', async () => {
      const { prisma, devices } = fakePrisma();
      const service = makeService(prisma);
      await pairOne(service, devices, 'u1');

      const now = daysLater(91);
      // Both read the device as live before either stamps it — the replica /
      // overlapping-redeploy case. The compare-and-set picks one winner.
      const results = await Promise.all([
        service.expireIdleDevices(now),
        service.expireIdleDevices(now),
      ]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(emitted).toHaveLength(1);
    });
  });
});
