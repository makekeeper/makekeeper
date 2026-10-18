import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, getErrorMessage } from '@makekeeper/backend-core';
import {
  isNiimbotHaTargetKind,
  type NiimbotHaSettings,
  type NiimbotHaTargetKind,
} from '../ha-contract';

export { type NiimbotHaSettings, type NiimbotHaTargetKind };

// Which printer on the household's Home Assistant this instance prints on, and
// how (#364).
//
// Instance settings, unlike every other setting this plugin has: the Web
// Bluetooth route belongs to one browser profile because that is who holds the
// device grant, while here the INSTANCE prints — the printer is reached from
// the server, over somebody else's radio, and is the same printer for everyone
// who can see the button.
//
// No secrets: the credential for reaching Home Assistant belongs to the
// `homeassistant` plugin, and this plugin never sees it.

const SETTINGS_ID = 'default';

const DEFAULTS: NiimbotHaSettings = {
  targetId: null,
  targetKind: 'device',
  printerName: null,
  soleTarget: false,
  sendSize: true,
};

@Injectable()
export class NiimbotHaSettingsService {
  private readonly logger = new Logger(NiimbotHaSettingsService.name);
  private cache: NiimbotHaSettings | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<NiimbotHaSettings> {
    if (this.cache) return this.cache;
    try {
      const row = await this.prisma.niimbotHaSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      this.cache = row
        ? {
            targetId: row.targetId ?? null,
            targetKind: isNiimbotHaTargetKind(row.targetKind)
              ? row.targetKind
              : 'device',
            printerName: row.printerName ?? null,
            soleTarget: row.soleTarget,
            sendSize: row.sendSize,
          }
        : { ...DEFAULTS };
    } catch (err) {
      // Not cached: one failed read must not become a standing answer. Cached,
      // it would hide the configured printer until a write or a restart.
      this.logger.error(
        `Failed to load Niimbot Home Assistant settings: ${getErrorMessage(err)}`,
      );
      return { ...DEFAULTS };
    }
    return this.cache;
  }

  async update(patch: {
    targetId?: string | null;
    targetKind?: NiimbotHaTargetKind;
    printerName?: string | null;
    soleTarget?: boolean;
    sendSize?: boolean;
  }): Promise<NiimbotHaSettings> {
    const current = await this.get();
    const next: NiimbotHaSettings = {
      targetId:
        patch.targetId !== undefined
          ? patch.targetId || null
          : current.targetId,
      targetKind: patch.targetKind ?? current.targetKind,
      printerName:
        patch.printerName !== undefined
          ? patch.printerName || null
          : current.printerName,
      soleTarget: patch.soleTarget ?? current.soleTarget,
      sendSize: patch.sendSize ?? current.sendSize,
    };
    await this.prisma.niimbotHaSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...next },
      update: next,
    });
    this.cache = next;
    return next;
  }
}
