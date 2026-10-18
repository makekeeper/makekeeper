import { NiimbotPrintSettingsService } from './print-settings.service';

// These two values reach a printhead, so what is stored has to stay inside
// what the machine accepts whatever a future screen — or a hand-edited row —
// puts there. `configured` carries the one-time carry-over: a screen may only
// hand over a browser's remembered values to an instance that never saved any.

function harness(row: Record<string, unknown> | null) {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    niimbotPrintSettings: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert,
    },
  };
  return { service: new NiimbotPrintSettingsService(prisma as never), upsert };
}

describe('NiimbotPrintSettingsService', () => {
  it('reads as unconfigured, at the printer’s own defaults', async () => {
    const { service } = harness(null);
    expect(await service.get()).toEqual({
      density: 3,
      labelType: 'withGaps',
      configured: false,
    });
  });

  it('is configured once a row exists', async () => {
    const { service } = harness({
      density: 4,
      labelType: 'transparent',
    });
    expect(await service.get()).toEqual({
      density: 4,
      labelType: 'transparent',
      configured: true,
    });
  });

  it('pulls a stored density back inside what the B1 accepts', async () => {
    const { service } = harness({ density: 42, labelType: 'withGaps' });
    expect((await service.get()).density).toBe(5);
  });

  it('falls back to gap labels for a stock it does not know', async () => {
    const { service } = harness({ density: 3, labelType: 'origami' });
    expect((await service.get()).labelType).toBe('withGaps');
  });

  it('clamps on the way in as well as on the way out', async () => {
    const { service, upsert } = harness(null);
    const saved = await service.update({ density: 0 });
    expect(saved.density).toBe(1);
    expect(upsert.mock.calls[0][0].update.density).toBe(1);
    // A write is what makes an instance configured, which is what stops the
    // carry-over from running twice.
    expect(saved.configured).toBe(true);
  });
});
