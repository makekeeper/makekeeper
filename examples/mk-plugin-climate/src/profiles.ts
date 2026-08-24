// Storage conditions per material — the plugin's actual domain knowledge.
//
// The numbers are the point; the names are i18n keys like everything else on
// screen. Kept in their own module because this is what a user would argue
// with, and it should be findable without reading the render code.

export interface Profile {
  maxHumidity: number;
  minTemp: number;
  maxTemp: number;
  // i18n key for the picker.
  labelKey: string;
}

export const PROFILES: Record<string, Profile> = {
  pla: { maxHumidity: 40, minTemp: 5, maxTemp: 35, labelKey: 'profilePla' },
  petg: { maxHumidity: 40, minTemp: 5, maxTemp: 35, labelKey: 'profilePetg' },
  nylon: { maxHumidity: 20, minTemp: 5, maxTemp: 35, labelKey: 'profileNylon' },
  resin: { maxHumidity: 50, minTemp: 18, maxTemp: 30, labelKey: 'profileResin' },
  electronics: {
    maxHumidity: 60,
    minTemp: 0,
    maxTemp: 40,
    labelKey: 'profileElectronics',
  },
  generic: {
    maxHumidity: 65,
    minTemp: -10,
    maxTemp: 45,
    labelKey: 'profileGeneric',
  },
};

export const profileOf = (name: string): Profile =>
  PROFILES[name] ?? PROFILES['generic'];
