import { NiimbotHaSettingsService } from './ha-print-settings.service';

// The row is written by an admin screen, but it is read by a print path, so
// what is stored has to stay inside what the printer accepts whatever a
// future screen (or a hand-edited row) puts there.

function harness(row: Record<string, unknown> | null) {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    niimbotHaSettings: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert,
    },
  };
  return {
    service: new NiimbotHaSettingsService(prisma as never),
    upsert,
  };
}

describe('NiimbotHaSettingsService', () => {
  it('starts with nothing chosen and the default burn and stock', async () => {
    const { service } = harness(null);
    expect(await service.get()).toEqual({
      targetId: null,
      targetKind: 'device',
      printerName: null,
      soleTarget: false,
      sendSize: true,
    });
  });

  it('reads an emptied target as nothing chosen', async () => {
    const { service, upsert } = harness(null);
    const saved = await service.update({ targetId: '' });
    expect(saved.targetId).toBeNull();
    expect(upsert.mock.calls[0][0].update.targetId).toBeNull();
  });
});
