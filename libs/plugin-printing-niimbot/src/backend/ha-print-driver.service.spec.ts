import {
  HOMEASSISTANT_API_CAPABILITY,
  rasterRowBytes,
  type HomeAssistantApiCapability,
  type PrintRaster,
} from '@makekeeper/plugin-contract';
import { NiimbotHaPrintDriverService } from './ha-print-driver.service';
import type { NiimbotHaSettings } from './ha-print-settings.service';
import type { NiimbotLabelType } from '../label-stock';

// What this driver promises is mostly about ABSENCE: it must not appear in a
// print dialog unless there is a Home Assistant to print through and a printer
// chosen on it, because a row that cannot print is worse than no row at all.
// The rest is the exact shape of one service call — the thing hardware will
// judge and no type can.

const page = (widthDots = 320, heightDots = 240): PrintRaster => ({
  widthDots,
  heightDots,
  rows: new Uint8Array(rasterRowBytes(widthDots) * heightDots),
});

const settingsOf = (
  patch: Partial<NiimbotHaSettings> = {},
): NiimbotHaSettings => ({
  targetId: 'dev-b1',
  targetKind: 'device',
  printerName: 'Workshop B1',
  soleTarget: false,
  sendSize: true,
  ...patch,
});

// How the printer prints is a separate row now (#366), so the driver reads it
// from a separate service.
const printSettingsStub = (
  patch: { density?: number; labelType?: NiimbotLabelType } = {},
) => ({
  get: jest.fn().mockResolvedValue({
    density: 3,
    labelType: 'withGaps',
    configured: true,
    ...patch,
  }),
});

function harness(
  options: {
    ha?: Partial<HomeAssistantApiCapability> | null;
    settings?: Partial<NiimbotHaSettings>;
    print?: { density?: number; labelType?: NiimbotLabelType };
  } = {},
) {
  const callService = jest.fn().mockResolvedValue({ ok: true, data: {} });
  const getStates = jest.fn().mockResolvedValue({
    ok: true,
    data: { entities: [], integrationFilterApplied: true },
  });
  const getDevices = jest.fn().mockResolvedValue({
    ok: true,
    data: { devices: [{ deviceId: 'dev-b1', name: 'Workshop B1' }] },
  });
  const ha =
    options.ha === null
      ? null
      : {
          isConfigured: () => true,
          getStates,
          getDevices,
          callService,
          ...options.ha,
        };
  const capabilities = {
    getCapability: jest.fn((id: string) =>
      id === HOMEASSISTANT_API_CAPABILITY ? ha : null,
    ),
  };
  const settings = {
    get: jest.fn().mockResolvedValue(settingsOf(options.settings)),
  };
  const service = new NiimbotHaPrintDriverService(
    // Every collaborator is used through its public surface only, so the stubs
    // above are the whole contract this driver has with them.
    capabilities as never,
    settings as never,
    printSettingsStub(options.print) as never,
  );
  return { service, callService, getStates, getDevices };
}

describe('NiimbotHaPrintDriverService.describe', () => {
  it('offers nothing when the Home Assistant plugin is absent or disabled', async () => {
    const { service } = harness({ ha: null });
    expect(await service.describe()).toBeNull();
  });

  it('offers nothing while Home Assistant has no address or token', async () => {
    const { service } = harness({ ha: { isConfigured: () => false } });
    expect(await service.describe()).toBeNull();
  });

  it('offers nothing while no printer has been chosen', async () => {
    const { service } = harness({
      settings: { targetId: null, printerName: null },
    });
    expect(await service.describe()).toBeNull();
  });

  it('describes the label page, not the printhead, and names the printer', async () => {
    const { service } = harness();
    expect(await service.describe()).toEqual({
      // The id IS the capability id: that is what `POST /api/printing/print`
      // resolves a driver by.
      id: 'printing.driver.printing-niimbot',
      pluginId: 'printing-niimbot',
      nameKey: 'printingNiimbot.driver.haName',
      routeKey: 'printingNiimbot.driver.haRoute',
      nameParams: { printer: 'Workshop B1' },
      maxWidthDots: 320,
      dpi: 203,
    });
  });

  it('falls back to the entity id when the printer has no remembered name', async () => {
    const { service } = harness({ settings: { printerName: null } });
    const descriptor = await service.describe();
    expect(descriptor?.nameParams).toEqual({ printer: 'dev-b1' });
  });

  it('names no printer for an instance printing on its only one', async () => {
    const { service } = harness({
      settings: { soleTarget: true, targetId: null, printerName: null },
    });
    const descriptor = await service.describe();
    expect(descriptor?.routeKey).toBe('printingNiimbot.driver.haRouteSole');
    expect(descriptor?.nameParams).toBeUndefined();
  });
});

describe('NiimbotHaPrintDriverService.print', () => {
  it('sends one dlimg page sized from the raster itself', async () => {
    const { service, callService } = harness();
    expect(await service.print(page(), { copies: 2 })).toEqual({ ok: true });
    expect(callService).toHaveBeenCalledTimes(1);
    const [domain, action, call] = callService.mock.calls[0];
    expect([domain, action]).toEqual(['niimbot', 'print']);
    // A DEVICE target: the printer itself, not one of its sensors.
    expect(call.target).toEqual({ deviceId: 'dev-b1' });
    expect(call.returnResponse).toBeUndefined();
    expect(call.data.payload).toHaveLength(1);
    expect(call.data.payload[0]).toMatchObject({
      type: 'dlimg',
      x: 0,
      y: 0,
      // Source size equals target size: imagespec resamples nothing, which is
      // what keeps the printed label the previewed label.
      xsize: 320,
      ysize: 240,
      rotate: 0,
      mode: 'stretch',
    });
    expect(call.data.payload[0].url.startsWith('data:image/png;base64,')).toBe(
      true,
    );
    expect(call.data).toMatchObject({
      width: 320,
      height: 240,
      density: 3,
      label_type: 1,
      copies: 2,
    });
  });

  it('omits the page size when Home Assistant should look it up', async () => {
    const { service, callService } = harness({ settings: { sendSize: false } });
    await service.print(page(), {});
    const { data } = callService.mock.calls[0][2];
    expect(data.width).toBeUndefined();
    expect(data.height).toBeUndefined();
  });

  it('aims at an entity when that is what was chosen', async () => {
    const { service, callService } = harness({
      settings: { targetKind: 'entity', targetId: 'button.b1_print' },
    });
    await service.print(page(), {});
    expect(callService.mock.calls[0][2].target).toEqual({
      entityId: 'button.b1_print',
    });
  });

  it('sends no target at all for the only printer in the house', async () => {
    const { service, callService } = harness({
      settings: { soleTarget: true },
    });
    await service.print(page(), {});
    expect(callService.mock.calls[0][2].target).toBeUndefined();
  });

  it('maps each label stock to the code hass-niimbot expects', async () => {
    for (const [labelType, code] of [
      ['withGaps', 1],
      ['black', 2],
      ['transparent', 5],
    ] as const) {
      const { service, callService } = harness({ print: { labelType } });
      await service.print(page(), {});
      expect(callService.mock.calls[0][2].data.label_type).toBe(code);
    }
  });

  it('clamps the number of copies to what the action accepts', async () => {
    const { service, callService } = harness();
    await service.print(page(), { copies: 500 });
    expect(callService.mock.calls[0][2].data.copies).toBe(99);
  });

  it('says there is nothing to print through when the gateway is gone', async () => {
    const { service } = harness({ ha: null });
    expect(await service.print(page(), {})).toEqual({
      ok: false,
      errorKey: 'printingNiimbot.ha.errors.noBridge',
    });
  });

  it('refuses a page Home Assistant could not render', async () => {
    const { service, callService } = harness();
    expect(await service.print(page(4, 4), {})).toEqual({
      ok: false,
      errorKey: 'printingNiimbot.ha.errors.pageSize',
    });
    expect(callService).not.toHaveBeenCalled();
  });

  it("forwards the gateway's own failure key unchanged", async () => {
    const { service } = harness({
      ha: {
        callService: jest.fn().mockResolvedValue({
          ok: false,
          errorKey: 'homeassistant.errors.unauthorized',
          status: 401,
        }),
      },
    });
    expect(await service.print(page(), {})).toMatchObject({
      ok: false,
      errorKey: 'homeassistant.errors.unauthorized',
    });
  });

  it('reads "no such action" as the integration not being installed', async () => {
    const { service } = harness({
      ha: {
        callService: jest.fn().mockResolvedValue({
          ok: false,
          errorKey: 'homeassistant.errors.badRequest',
          status: 400,
          detail: 'Service niimbot.print not found.',
        }),
      },
    });
    expect(await service.print(page(), {})).toMatchObject({
      errorKey: 'printingNiimbot.ha.errors.integrationMissing',
    });
  });

  it('leaves an ordinary bad request as a bad request', async () => {
    const { service } = harness({
      ha: {
        callService: jest.fn().mockResolvedValue({
          ok: false,
          errorKey: 'homeassistant.errors.badRequest',
          status: 400,
          detail: "expected int for dictionary value @ data['density']",
        }),
      },
    });
    expect(await service.print(page(), {})).toMatchObject({
      errorKey: 'homeassistant.errors.badRequest',
    });
  });
});

describe('NiimbotHaPrintDriverService.listPrinters', () => {
  it('reports why there is nothing to list', async () => {
    const absent = harness({ ha: null });
    expect(await absent.service.listPrinters()).toMatchObject({
      bridge: 'absent',
      printers: [],
    });
    const unconfigured = harness({ ha: { isConfigured: () => false } });
    expect(await unconfigured.service.listPrinters()).toMatchObject({
      bridge: 'unconfigured',
    });
  });

  it('lists the printers themselves, not their sensors', async () => {
    const { service, getDevices, getStates } = harness({
      ha: {
        getDevices: jest.fn().mockResolvedValue({
          ok: true,
          data: {
            devices: [
              { deviceId: 'dev-b1', name: 'Workshop B1' },
              { deviceId: 'dev-d110', name: 'Desk D110' },
            ],
          },
        }),
      },
    });
    expect(await service.listPrinters()).toEqual({
      bridge: 'ok',
      kind: 'device',
      printers: [
        { id: 'dev-b1', name: 'Workshop B1' },
        { id: 'dev-d110', name: 'Desk D110' },
      ],
    });
    // The entity list is not even asked for while the devices are known.
    expect(getStates).not.toHaveBeenCalled();
    void getDevices;
  });

  it('falls back to entities when the device registry cannot be reached', async () => {
    const { service } = harness({
      ha: {
        getDevices: jest.fn().mockResolvedValue({ ok: false, errorKey: 'x' }),
        getStates: jest.fn().mockResolvedValue({
          ok: true,
          data: {
            entities: [
              {
                entityId: 'button.b1_print',
                state: 'idle',
                friendlyName: 'Niimbot B1 Print',
              },
              {
                entityId: 'sensor.b1_rfid',
                state: 'ok',
                friendlyName: null,
              },
            ],
            integrationFilterApplied: true,
          },
        }),
      },
    });
    const printers = await service.listPrinters();
    expect(printers).toEqual({
      bridge: 'ok',
      kind: 'entity',
      filtered: true,
      printers: [
        { id: 'button.b1_print', name: 'Niimbot B1 Print' },
        // No friendly name: the id is the only honest label.
        { id: 'sensor.b1_rfid', name: 'sensor.b1_rfid' },
      ],
    });
  });

  it('falls back to entities when the integration has no devices', async () => {
    const { service } = harness({
      ha: {
        getDevices: jest
          .fn()
          .mockResolvedValue({ ok: true, data: { devices: [] } }),
        getStates: jest.fn().mockResolvedValue({
          ok: true,
          data: { entities: [], integrationFilterApplied: false },
        }),
      },
    });
    const printers = await service.listPrinters();
    expect(printers.kind).toBe('entity');
    expect(printers.filtered).toBe(false);
  });
});

describe('NiimbotHaPrintDriverService.testPreview', () => {
  it("tests the screen's own values, not only what was saved", async () => {
    // The case that sent an admin looking for a bug: one printer, chosen by
    // the screen, not saved yet — the dry run used to answer "no printer".
    const { service, callService } = harness({
      settings: { targetId: null, printerName: null },
    });
    expect(
      await service.testPreview({ targetId: 'dev-b1', targetKind: 'device' }),
    ).toEqual({ ok: true });
    expect(callService.mock.calls[0][2].target).toEqual({ deviceId: 'dev-b1' });
  });

  it('still refuses when neither the screen nor the row names a printer', async () => {
    const { service } = harness({ settings: { targetId: null } });
    expect(await service.testPreview({})).toEqual({
      ok: false,
      stage: 'device',
      errorKey: 'printingNiimbot.ha.errors.noEntity',
    });
  });

  it('asks the PRINTER first, then renders', async () => {
    const { service, callService } = harness();
    expect(await service.testPreview()).toEqual({
      ok: true,
      image: undefined,
    });
    // A render alone would come back perfect from a Home Assistant whose
    // printer has been in a drawer for a month, so the device is asked first.
    expect(callService.mock.calls.map((c) => c[1])).toEqual([
      'refresh_info',
      'print',
    ]);
    const call = callService.mock.calls[1][2];
    expect(call.data.preview).toBe(true);
    expect(call.returnResponse).toBe(true);
    expect(call.data.payload[0]).toMatchObject({ xsize: 320, ysize: 240 });
  });

  it('says so when the printer itself does not answer', async () => {
    const refusing = jest.fn().mockResolvedValue({
      ok: false,
      errorKey: 'homeassistant.errors.badRequest',
      status: 400,
      detail: 'printer unreachable',
    });
    const { service } = harness({ ha: { callService: refusing } });
    expect(await service.testPreview()).toMatchObject({
      ok: false,
      stage: 'device',
      errorKey: 'homeassistant.errors.badRequest',
    });
    // Nothing was drawn: the chain stopped at the hardware.
    expect(refusing.mock.calls).toHaveLength(1);
    expect(refusing.mock.calls[0][1]).toBe('refresh_info');
  });

  it('tests the configuration as it stands, page size included', async () => {
    // The dry run used to send the size unconditionally, so `sendSize: false`
    // — the one setting that hands sizing to Home Assistant — was the one it
    // could not prove.
    const { service, callService } = harness({ settings: { sendSize: false } });
    await service.testPreview();
    const { data } = callService.mock.calls[1][2];
    expect(data.width).toBeUndefined();
    expect(data.height).toBeUndefined();
    expect(data.preview).toBe(true);
    // And a dry run never asks for copies: it prints nothing.
    expect(data.copies).toBeUndefined();
  });

  it('hands back the page Home Assistant drew', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const { service } = harness({
      ha: {
        callService: jest
          .fn()
          .mockResolvedValue({ ok: true, data: { response: { image } } }),
      },
    });
    expect(await service.testPreview()).toEqual({ ok: true, image });
  });

  it('finds the render when the answer is keyed by printer', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    const { service } = harness({
      ha: {
        callService: jest.fn().mockResolvedValue({
          ok: true,
          data: { response: { 'B1-2E4A': { image, result: 'ok' } } },
        }),
      },
    });
    expect(await service.testPreview()).toEqual({ ok: true, image });
  });

  it('ignores an answer that is not a picture', async () => {
    const { service } = harness({
      ha: {
        callService: jest.fn().mockResolvedValue({
          ok: true,
          data: { response: { image: 'https://example.invalid/label.png' } },
        }),
      },
    });
    // A success without a render is still a success — it is just not shown as
    // one, and never fetched from wherever that string points.
    expect(await service.testPreview()).toEqual({ ok: true, image: undefined });
  });
});
