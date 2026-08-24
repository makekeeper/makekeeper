import {
  ExchangeSectionProvider,
  PrismaService,
  isExchangeRecord,
  readNumber,
  readOptionalString,
  readString,
} from '@makekeeper/backend-core';
import {
  DEFAULT_IDLE_TTL_MINUTES,
  DEFAULT_TUNNEL_MODE,
  PHONE_BRIDGE_SETTINGS_ID,
  TUNNEL_MODE_MAX_LENGTH,
} from './phone-bridge-settings.constants';

// Instance-backup section of the phone-bridge plugin (#77): the tunnel settings
// singleton (tunnel mode / cloudflared path / idle TTL). Instance-wide config,
// not per-user data — declared for the instance root only in the manifest.

export function createPhoneBridgeExchangeProviders(
  prisma: PrismaService,
): ExchangeSectionProvider[] {
  const settingsProvider: ExchangeSectionProvider = {
    sectionKey: 'phone-bridge.settings',

    async exportSection() {
      const records: Record<string, unknown>[] = [];
      const settings = await prisma.phoneBridgeSettings.findUnique({
        where: { id: PHONE_BRIDGE_SETTINGS_ID },
      });
      if (settings) {
        records.push({
          t: 'phoneBridgeSettings',
          tunnelMode: settings.tunnelMode,
          cloudflaredPath: settings.cloudflaredPath,
          tunnelIdleTtlMinutes: settings.tunnelIdleTtlMinutes,
        });
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'phoneBridgeSettings'))
          .length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'phoneBridgeSettings')) continue;
        const tunnelMode =
          readString(raw, 'tunnelMode', TUNNEL_MODE_MAX_LENGTH) ??
          DEFAULT_TUNNEL_MODE;
        const cloudflaredPath = readOptionalString(
          raw,
          'cloudflaredPath',
          1000,
        );
        const tunnelIdleTtlMinutes =
          readNumber(raw, 'tunnelIdleTtlMinutes') ?? DEFAULT_IDLE_TTL_MINUTES;
        await ctx.tx.phoneBridgeSettings.upsert({
          where: { id: PHONE_BRIDGE_SETTINGS_ID },
          create: {
            id: PHONE_BRIDGE_SETTINGS_ID,
            tunnelMode,
            cloudflaredPath,
            tunnelIdleTtlMinutes,
          },
          update: { tunnelMode, cloudflaredPath, tunnelIdleTtlMinutes },
        });
        created += 1;
      }
      return { created };
    },

    async countExistingRows(tx) {
      return tx.phoneBridgeSettings.count();
    },
  };

  return [settingsProvider];
}
