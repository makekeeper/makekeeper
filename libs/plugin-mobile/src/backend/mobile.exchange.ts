import {
  ExchangeSectionProvider,
  PrismaService,
  isExchangeRecord,
  readOptionalString,
} from '@makekeeper/backend-core';
import {
  CUSTOM_ORIGIN_MAX_LENGTH,
  MOBILE_SETTINGS_ID,
} from './mobile-settings.constants';

// Instance-backup section of the mobile plugin: the settings singleton (the
// published address). Instance-wide configuration, so it is declared for the
// instance root only.
//
// Paired devices are deliberately NOT exported. A device token is a credential,
// not configuration; restoring one into a different instance would hand a phone
// standing access to data it was never paired with.
export function createMobileExchangeProvider(
  prisma: PrismaService,
): ExchangeSectionProvider {
  return {
    sectionKey: 'mobile.instance',

    async exportSection() {
      const settings = await prisma.mobileSettings.findUnique({
        where: { id: MOBILE_SETTINGS_ID },
      });
      return {
        records: settings
          ? [{ t: 'mobileSettings', customOrigin: settings.customOrigin }]
          : [],
      };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'mobileSettings'))
          .length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'mobileSettings')) continue;
        // An archive written before #210 still carries `testMode`; it is simply
        // dropped — the flag no longer decides anything.
        const customOrigin = readOptionalString(
          raw,
          'customOrigin',
          CUSTOM_ORIGIN_MAX_LENGTH,
        );
        await ctx.tx.mobileSettings.upsert({
          where: { id: MOBILE_SETTINGS_ID },
          create: { id: MOBILE_SETTINGS_ID, customOrigin },
          update: { customOrigin },
        });
        created += 1;
      }
      return { created, updated: 0, skipped: 0 };
    },
  };
}
