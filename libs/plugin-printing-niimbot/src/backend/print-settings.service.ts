import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, getErrorMessage } from '@makekeeper/backend-core';
import {
  clampDensity,
  DENSITY_DEFAULT,
  isNiimbotLabelType,
} from '../label-stock';
import type {
  NiimbotPrintSettings,
  NiimbotPrintSettingsPatch,
} from '../print-contract';

// How the printer prints: how hard the head burns, and what roll is in it
// (#366).
//
// Instance settings, and not per browser, because neither value is about a
// browser: they describe the machine. The panel used to ask for both twice —
// once for the Bluetooth route and once for the Home Assistant one — purely
// because the two routes stored them in different places. One row, read by
// both.
//
// `configured` is how the screen knows whether anything was ever saved here,
// which is what the one-time carry-over from a browser's own remembered values
// hangs on: an instance that has never had print settings takes them from the
// first admin who had some.

const SETTINGS_ID = 'default';

const DEFAULTS: NiimbotPrintSettings = {
  density: DENSITY_DEFAULT,
  labelType: 'withGaps',
  configured: false,
};

@Injectable()
export class NiimbotPrintSettingsService {
  private readonly logger = new Logger(NiimbotPrintSettingsService.name);
  private cache: NiimbotPrintSettings | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<NiimbotPrintSettings> {
    if (this.cache) return this.cache;
    try {
      const row = await this.prisma.niimbotPrintSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      // A row that is not there yet is not an answer to cache: another admin
      // (or another replica) may write one a second later, and a cached
      // absence would let the carry-over run again from a second browser and
      // overwrite what the first one carried over.
      if (!row) return { ...DEFAULTS };
      this.cache = {
        density: clampDensity(row.density),
        labelType: isNiimbotLabelType(row.labelType)
          ? row.labelType
          : DEFAULTS.labelType,
        configured: true,
      };
    } catch (err) {
      // Not cached: one failed read must not become a standing answer.
      this.logger.error(
        `Failed to load Niimbot print settings: ${getErrorMessage(err)}`,
      );
      return { ...DEFAULTS };
    }
    return this.cache;
  }

  async update(
    patch: NiimbotPrintSettingsPatch,
  ): Promise<NiimbotPrintSettings> {
    const current = await this.get();
    const next = {
      density:
        patch.density === undefined
          ? current.density
          : clampDensity(patch.density),
      labelType: patch.labelType ?? current.labelType,
    };
    await this.prisma.niimbotPrintSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...next },
      update: next,
    });
    this.cache = { ...next, configured: true };
    return this.cache;
  }
}
