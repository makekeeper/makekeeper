import { Injectable, Logger } from '@nestjs/common';
import { CapabilityRegistryService } from '@makekeeper/backend-core';
import {
  HOMEASSISTANT_API_CAPABILITY,
  isHomeAssistantFailure,
  printDriverCapability,
  rasterRowBytes,
  type HomeAssistantApiCapability,
  type HomeAssistantFailure,
  type PrintDriverCapability,
  type PrintDriverDescriptor,
  type PrintJobOptions,
  type PrintRaster,
  type PrintResult,
} from '@makekeeper/plugin-contract';
import {
  B1_DPI,
  B1_LABEL_HEIGHT_DOTS,
  B1_LABEL_WIDTH_DOTS,
  HA_LABEL_TYPE_CODES,
} from '../label-stock';
import type { NiimbotPrintSettings } from '../print-contract';
import { printingNiimbotManifest } from '../manifest';
import type { NiimbotHaPreviewResult, NiimbotHaPrinters } from '../ha-contract';
import {
  NiimbotHaSettingsService,
  type NiimbotHaSettings,
} from './ha-print-settings.service';
import { NiimbotPrintSettingsService } from './print-settings.service';
import { RasterEncodeError, rasterToPngDataUri } from './raster-png';

// Re-exported so the controller still names its return types from the service
// it calls, while the shapes themselves live where BOTH halves read them
// (`../ha-contract`) instead of being hand-copied into the settings screen.
export type { NiimbotHaPreviewResult, NiimbotHaPrinters };

// Printing a label on a Niimbot that Home Assistant owns (#364).
//
// A server-side driver, so it is the answer for a browser that cannot reach a
// printer itself — every browser on iOS, where Web Bluetooth does not exist —
// and it needs no Bluetooth of ours at all: Home Assistant already talks to
// the printer, through its own stack and its own proxies, and we ask it to.
//
// The HA connection arrives as a CAPABILITY, resolved per call. That is the
// whole architecture of this file: this plugin knows what a Niimbot is and the
// `homeassistant` plugin knows how to reach a household server, and neither
// imports the other (§5.10). `null` from the registry — plugin absent,
// disabled, or unconfigured — means this route does not exist, so `describe()`
// answers `null` and the row simply is not in the print dialog.

// hass-niimbot renders the page through `imagespec`, whose `dlimg` element
// takes a `data:` URI and a target size. Source size equals target size here,
// which is what guarantees the printed label is the previewed label pixel for
// pixel: nothing is resampled.
const HA_DOMAIN = 'niimbot';
const HA_SERVICE = 'print';
// A real round trip to the printer: hass-niimbot re-reads its settings and
// device info over Bluetooth. Nothing else in its surface asks the hardware a
// question without spending a label — its own test-page button prints one, and
// the connection beep is a SETTING (it sounds on the next connect), not a
// command — so this is what a check uses to prove the chain reaches metal.
const HA_REFRESH_SERVICE = 'refresh_info';
// `services.yaml`: width/height 10…1600, copies 1…99.
const CANVAS_MIN = 10;
const CANVAS_MAX = 1600;
const COPIES_MAX = 99;

// Only an image, and only a small one: the value travels from a household
// server into a settings screen, so it is checked for being a PNG data URI
// before anything renders it, and a server answering with megabytes is
// treated as answering with nothing.
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const PREVIEW_PREFIX = 'data:image/';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function previewImage(response: unknown): string | undefined {
  const pick = (value: unknown): string | undefined => {
    if (!isRecord(value)) return undefined;
    const image = value['image'];
    return typeof image === 'string' &&
      image.startsWith(PREVIEW_PREFIX) &&
      image.length <= MAX_PREVIEW_BYTES
      ? image
      : undefined;
  };
  // Aimed at one printer the answer is the render itself; aimed at several
  // Home Assistant keys it by printer address, so one level down is looked at
  // too — any of them proves the render.
  const direct = pick(response);
  if (direct) return direct;
  if (!isRecord(response)) return undefined;
  for (const value of Object.values(response)) {
    const nested = pick(value);
    if (nested) return nested;
  }
  return undefined;
}

// The job itself: one page, as hass-niimbot takes it. Built in one place
// because the print path and the dry run must differ in exactly two things —
// how many copies, and whether anything comes out. They had already begun to
// differ otherwise: the dry run always sent the page size, so the one
// configuration it could not prove was the one that leaves the size to Home
// Assistant's own label lookup.
function printJobData(
  settings: NiimbotHaSettings,
  print: NiimbotPrintSettings,
  page: { url: string; widthDots: number; heightDots: number },
  extras: { copies?: number; preview?: boolean },
): Record<string, unknown> {
  return {
    payload: [
      {
        type: 'dlimg',
        x: 0,
        y: 0,
        url: page.url,
        xsize: page.widthDots,
        ysize: page.heightDots,
        rotate: 0,
        mode: 'stretch',
      },
    ],
    // Off hands the page size to hass-niimbot's own label lookup, which reads
    // the roll's own tag — better than our guess when the stock is not what
    // this driver assumes.
    ...(settings.sendSize
      ? { width: page.widthDots, height: page.heightDots }
      : {}),
    rotate: 0,
    density: print.density,
    label_type: HA_LABEL_TYPE_CODES[print.labelType],
    ...(extras.copies === undefined ? {} : { copies: extras.copies }),
    ...(extras.preview === undefined ? {} : { preview: extras.preview }),
  };
}

// Where the job is aimed. `undefined` for the only printer in the house:
// hass-niimbot resolves it itself, and naming a target we were never told
// about would be a guess.
function targetOf(
  settings: NiimbotHaSettings,
): { entityId?: string; deviceId?: string } | undefined {
  if (settings.soleTarget || !settings.targetId) return undefined;
  return settings.targetKind === 'entity'
    ? { entityId: settings.targetId }
    : { deviceId: settings.targetId };
}

@Injectable()
export class NiimbotHaPrintDriverService implements PrintDriverCapability {
  private readonly logger = new Logger(NiimbotHaPrintDriverService.name);

  constructor(
    private readonly capabilities: CapabilityRegistryService,
    private readonly settings: NiimbotHaSettingsService,
    // How to print is a separate question from where to send it (#366), and
    // the answer is the same for every route.
    private readonly printSettings: NiimbotPrintSettingsService,
  ) {}

  private ha(): HomeAssistantApiCapability | null {
    return this.capabilities.getCapability<HomeAssistantApiCapability>(
      HOMEASSISTANT_API_CAPABILITY,
    );
  }

  // Asked on every print dialog, so it stays local: the registry, a cached
  // settings row, and no request to anybody's house.
  async describe(): Promise<PrintDriverDescriptor | null> {
    const ha = this.ha();
    if (!ha || !ha.isConfigured()) return null;
    const settings = await this.settings.get();
    if (!settings.soleTarget && !settings.targetId) return null;
    // The printer's own name travels as DATA, and the sentence around it
    // stays in the locale file (§5.4/§5.5). An instance printing on its only
    // printer has no name to show — it never named one — so it gets the
    // sentence without the slot rather than a hole or a repeated key.
    const printer = settings.soleTarget
      ? null
      : (settings.printerName ?? settings.targetId);
    return {
      id: printDriverCapability(printingNiimbotManifest.id),
      pluginId: printingNiimbotManifest.id,
      nameKey: 'printingNiimbot.driver.haName',
      routeKey: printer
        ? 'printingNiimbot.driver.haRoute'
        : 'printingNiimbot.driver.haRouteSole',
      ...(printer ? { nameParams: { printer } } : {}),
      maxWidthDots: B1_LABEL_WIDTH_DOTS,
      dpi: B1_DPI,
    };
  }

  async print(
    raster: PrintRaster,
    options: PrintJobOptions,
  ): Promise<PrintResult> {
    const ha = this.ha();
    if (!ha) {
      return { ok: false, errorKey: 'printingNiimbot.ha.errors.noBridge' };
    }
    const settings = await this.settings.get();
    if (!settings.soleTarget && !settings.targetId) {
      return { ok: false, errorKey: 'printingNiimbot.ha.errors.noEntity' };
    }
    const { widthDots, heightDots } = raster;
    if (
      widthDots < CANVAS_MIN ||
      heightDots < CANVAS_MIN ||
      widthDots > CANVAS_MAX ||
      heightDots > CANVAS_MAX
    ) {
      return { ok: false, errorKey: 'printingNiimbot.ha.errors.pageSize' };
    }

    let url: string;
    try {
      url = await rasterToPngDataUri(raster);
    } catch (err) {
      if (err instanceof RasterEncodeError) {
        return { ok: false, errorKey: err.errorKey };
      }
      throw err;
    }

    const copies = Math.min(
      COPIES_MAX,
      Math.max(1, Math.round(options.copies ?? 1)),
    );
    const result = await ha.callService(HA_DOMAIN, HA_SERVICE, {
      // No target at all when the household has exactly one printer:
      // hass-niimbot then resolves it itself, and naming an entity we were
      // never told about would be a guess.
      target: targetOf(settings),
      data: printJobData(
        settings,
        await this.printSettings.get(),
        { url, widthDots, heightDots },
        { copies },
      ),
      // Deliberately not asking for the action's response: Home Assistant
      // answers 400 to `return_response` on an action that has none, and a
      // print that worked must not be reported as a failure by the question we
      // asked about it. The preview path asks; this one does not.
    });
    if (isHomeAssistantFailure(result)) {
      this.logger.warn(
        `Home Assistant refused the print job (${result.errorKey}).`,
      );
      return {
        ok: false,
        errorKey: this.refine(result),
        params: result.params,
      };
    }
    return { ok: true };
  }

  // ── The settings screen's two questions ───────────────────────────────────
  //
  // Answered here because this is where the Home Assistant capability is
  // resolved: the screen must never call another plugin's API itself (§5.10),
  // so it asks its own plugin, which asks the gateway.

  async listPrinters(): Promise<NiimbotHaPrinters> {
    const ha = this.ha();
    if (!ha) return { bridge: 'absent', printers: [], kind: 'device' };
    if (!ha.isConfigured()) {
      return { bridge: 'unconfigured', printers: [], kind: 'device' };
    }
    // DEVICES first, because a device is the printer: hass-niimbot gives one
    // B1 a cover, a paper sensor, an RFID tag and a connectivity entity, and a
    // picker listing those asks an admin to choose a property of their printer.
    const devices = await ha.getDevices(HA_DOMAIN);
    if (!isHomeAssistantFailure(devices) && devices.data.devices.length > 0) {
      return {
        bridge: 'ok',
        kind: 'device',
        printers: devices.data.devices.map((device) => ({
          id: device.deviceId,
          name: device.name,
        })),
      };
    }
    // An instance that refuses templates has no device registry we can reach,
    // so the entities are all that is left. The UI says which it is looking at
    // rather than calling an RFID sensor a printer.
    const states = await ha.getStates({ integration: HA_DOMAIN });
    if (isHomeAssistantFailure(states)) {
      return {
        bridge: 'ok',
        kind: 'entity',
        printers: [],
        errorKey: states.errorKey,
      };
    }
    return {
      bridge: 'ok',
      kind: 'entity',
      printers: states.data.entities.map((entity) => ({
        id: entity.entityId,
        name: entity.friendlyName ?? entity.entityId,
      })),
      filtered: states.data.integrationFilterApplied,
    };
  }

  // Renders the test pattern through Home Assistant WITHOUT printing it
  // (`preview: true`), which is the cheapest honest proof of the whole chain:
  // the address answers, the token is accepted, the integration is installed
  // and the entity is one it owns. No label is spent finding that out.
  async testPreview(
    // What the settings SCREEN is holding, which may not be what is stored:
    // the test belongs to the form, not to the database. A button that reports
    // on the previously saved printer right after somebody picked a new one
    // answers the wrong question — and on a Home Assistant with one printer,
    // where the screen chooses it silently, it answered "no printer chosen" to
    // a screen that plainly showed one.
    override?: Partial<NiimbotHaSettings>,
  ): Promise<NiimbotHaPreviewResult> {
    const ha = this.ha();
    if (!ha) {
      return {
        ok: false,
        stage: 'device',
        errorKey: 'printingNiimbot.ha.errors.noBridge',
      };
    }
    const stored = await this.settings.get();
    const settings: NiimbotHaSettings = { ...stored, ...(override ?? {}) };
    if (!settings.soleTarget && !settings.targetId) {
      return {
        ok: false,
        stage: 'device',
        errorKey: 'printingNiimbot.ha.errors.noEntity',
      };
    }
    // The printer first. A render proves the software path and nothing else:
    // it would come back perfect from a Home Assistant whose printer has been
    // in a drawer for a month.
    const awake = await ha.callService(HA_DOMAIN, HA_REFRESH_SERVICE, {
      target: targetOf(settings),
    });
    if (isHomeAssistantFailure(awake)) {
      return {
        ok: false,
        stage: 'device',
        errorKey: this.refine(awake),
        params: awake.params,
      };
    }

    const raster = testPatternRaster(B1_LABEL_WIDTH_DOTS, B1_LABEL_HEIGHT_DOTS);
    let url: string;
    try {
      url = await rasterToPngDataUri(raster);
    } catch (err) {
      if (err instanceof RasterEncodeError) {
        return { ok: false, stage: 'render', errorKey: err.errorKey };
      }
      throw err;
    }
    const result = await ha.callService(HA_DOMAIN, HA_SERVICE, {
      target: targetOf(settings),
      // The dry run carries the same page size the real job would, so it
      // exercises the configuration being tested and not a flattering one.
      data: printJobData(
        settings,
        await this.printSettings.get(),
        { url, widthDots: raster.widthDots, heightDots: raster.heightDots },
        { preview: true },
      ),
      // This action DOES answer when previewing (it hands back the rendered
      // image), so asking for the response is safe here and tells us the
      // render itself succeeded rather than only that the call was accepted.
      returnResponse: true,
    });
    if (isHomeAssistantFailure(result)) {
      return {
        ok: false,
        stage: 'render',
        errorKey: this.refine(result),
        params: result.params,
      };
    }
    return { ok: true, image: previewImage(result.data.response) };
  }

  // A 400 naming the action is Home Assistant saying "there is no such
  // service here", which in practice means hass-niimbot is not installed —
  // a different thing for an admin to fix than a malformed request, and the
  // only place the two can be told apart is here, where we know what we asked
  // for.
  private refine(failure: HomeAssistantFailure): string {
    const { errorKey, status, detail } = failure;
    if (status !== 400 || !detail) return errorKey;
    const text = detail.toLowerCase();
    const namesOurAction =
      text.includes(`${HA_DOMAIN}.${HA_SERVICE}`) || text.includes(HA_DOMAIN);
    const missing = text.includes('not found') || text.includes('unknown');
    return namesOurAction && missing
      ? 'printingNiimbot.ha.errors.integrationMissing'
      : errorKey;
  }
}

// A frame with a cross through it, at the page size this driver sends. It
// exists for the settings screen's dry run: something with ink at all four
// edges proves the page arrived whole and the right way round, and it is not a
// label — nobody should have to interpret a test pattern as data.
export function testPatternRaster(
  widthDots: number,
  heightDots: number,
): PrintRaster {
  const stride = rasterRowBytes(widthDots);
  const rows = new Uint8Array(stride * heightDots);
  const ink = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= widthDots || y >= heightDots) return;
    rows[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  };
  for (let x = 0; x < widthDots; x += 1) {
    ink(x, 0);
    ink(x, heightDots - 1);
    ink(x, Math.floor((x * (heightDots - 1)) / (widthDots - 1)));
    ink(
      x,
      heightDots - 1 - Math.floor((x * (heightDots - 1)) / (widthDots - 1)),
    );
  }
  for (let y = 0; y < heightDots; y += 1) {
    ink(0, y);
    ink(widthDots - 1, y);
  }
  return { widthDots, heightDots, rows };
}
