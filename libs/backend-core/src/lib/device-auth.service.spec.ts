import { DeviceAuthService } from './device-auth.service';
import type { PrismaService } from './prisma.service';
import type { PluginEventBusService } from './plugin-event-bus.service';

// A bus that records what was announced, so a test can assert the revoke told
// anybody (#311) without wiring real listeners.
const emitted: Array<{ event: string; payload: unknown }> = [];
const events = (): PluginEventBusService =>
  ({
    emit: async (event: string, payload: unknown) => {
      emitted.push({ event, payload });
    },
  }) as unknown as PluginEventBusService;

beforeEach(() => {
  emitted.length = 0;
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
    const service = new DeviceAuthService(prisma, events());

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
    const service = new DeviceAuthService(prisma, events());

    const { code } = await service.issuePairingCode('u1');
    await service.redeemPairingCode(code, 'first');

    // The screenshot case: the same QR, a second phone.
    await expect(service.redeemPairingCode(code, 'second')).resolves.toBeNull();
  });

  it('refuses an expired code', async () => {
    const { prisma } = fakePrisma();
    const service = new DeviceAuthService(prisma, events());

    const issuedAt = new Date('2026-07-31T10:00:00Z');
    const { code } = await service.issuePairingCode('u1', issuedAt);

    const muchLater = new Date('2026-07-31T11:00:00Z');
    await expect(
      service.redeemPairingCode(code, 'late phone', muchLater),
    ).resolves.toBeNull();
  });

  it('binds the device to the user who issued the code, and to nobody in single-user mode', async () => {
    const { prisma } = fakePrisma();
    const service = new DeviceAuthService(prisma, events());

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
    const service = new DeviceAuthService(prisma, events());

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
    const service = new DeviceAuthService(prisma, events());

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
    const service = new DeviceAuthService(prisma, events());
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
    const service = new DeviceAuthService(prisma, events());
    // A JWT arriving here must fall through, not throw — the guard tries both.
    await expect(
      service.resolveToken('header.payload.sig'),
    ).resolves.toBeNull();
  });
});
