import { useI18n } from 'vue-i18n';

// Binary units, matching what `du -h` on the same directory prints — an admin
// checking a figure by hand must not find a decimal-vs-binary discrepancy.
//
// The symbols themselves are i18n keys, not literals (§5.5): "KiB" is not
// universal — ru writes "КиБ" — and the unit is user-visible text like any
// other. Shared by every disk surface so a size never reads two ways.
const UNIT_KEYS = [
  'settings.disk.unit.b',
  'settings.disk.unit.kib',
  'settings.disk.unit.mib',
  'settings.disk.unit.gib',
  'settings.disk.unit.tib',
] as const;

export function useFormatBytes(): (bytes: number) => string {
  const { t } = useI18n();

  return (bytes: number): string => {
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNIT_KEYS.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${t(UNIT_KEYS[unit])}`;
  };
}
