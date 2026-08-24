// Connection settings — owned by the plugin, edited in the UI (#146).
//
// Environment variables are kept, but only as DEFAULTS for a headless install
// (Ansible, a prebuilt stack). Anything a user is expected to change — a
// printer's address, an access code, an HA token — belongs on a settings
// screen: editing a compose file and restarting a container to fix a typo is
// not a user interface.
//
// The access code is a secret this plugin stores. It is never rendered back:
// the field shows empty with a "already set" hint, and a blank submit leaves
// the stored value alone. A submitted value travels browser → core → plugin
// over the signed channel, so the core sees it in transit — inherent to
// server-driven UI, and worth knowing rather than discovering.

export type SourceKind = 'lan' | 'ha' | 'none';

export interface Config {
  source: SourceKind;
  // LAN source.
  host: string;
  serial: string;
  accessCode: string;
  // Home Assistant source.
  haUrl: string;
  haToken: string;
  haEntityState: string;
  haEntityProgress: string;
  haEntityRemaining: string;
  haEntityNozzle: string;
  haEntityBed: string;
  haEntityJob: string;
}

const env = (name: string): string => process.env[name] ?? '';

export const defaultConfig = (): Config => {
  const host = env('BAMBU_HOST');
  const haUrl = env('HA_URL');
  return {
    // Whatever the environment configured wins on a fresh install; the admin
    // can switch sources in the UI afterwards.
    source: host ? 'lan' : haUrl ? 'ha' : 'none',
    host,
    serial: env('BAMBU_SERIAL'),
    accessCode: env('BAMBU_ACCESS_CODE'),
    haUrl,
    haToken: env('HA_TOKEN'),
    haEntityState: env('HA_ENTITY_STATE'),
    haEntityProgress: env('HA_ENTITY_PROGRESS'),
    haEntityRemaining: env('HA_ENTITY_REMAINING'),
    haEntityNozzle: env('HA_ENTITY_NOZZLE'),
    haEntityBed: env('HA_ENTITY_BED'),
    haEntityJob: env('HA_ENTITY_JOB'),
  };
};

// Which fields a submitted form may overwrite, and how. Secrets are special:
// an empty submission means "leave it as it was", because the form never shows
// the current value to begin with.
export const applyForm = (
  current: Config,
  values: Record<string, string | number | boolean>,
): Config => {
  const text = (name: string, fallback: string): string => {
    const value = values[name];
    return typeof value === 'string' ? value.trim() : fallback;
  };
  const secret = (name: string, fallback: string): string => {
    const value = values[name];
    const typed = typeof value === 'string' ? value.trim() : '';
    return typed === '' ? fallback : typed;
  };
  const source = text('source', current.source);
  return {
    source:
      source === 'lan' || source === 'ha' || source === 'none'
        ? source
        : current.source,
    host: text('host', current.host),
    serial: text('serial', current.serial),
    accessCode: secret('accessCode', current.accessCode),
    haUrl: text('haUrl', current.haUrl),
    haToken: secret('haToken', current.haToken),
    haEntityState: text('haEntityState', current.haEntityState),
    haEntityProgress: text('haEntityProgress', current.haEntityProgress),
    haEntityRemaining: text('haEntityRemaining', current.haEntityRemaining),
    haEntityNozzle: text('haEntityNozzle', current.haEntityNozzle),
    haEntityBed: text('haEntityBed', current.haEntityBed),
    haEntityJob: text('haEntityJob', current.haEntityJob),
  };
};

// Enough to try connecting? Reported on the settings screen so a half-filled
// form says what is missing instead of silently doing nothing.
export const isComplete = (config: Config): boolean => {
  if (config.source === 'lan') {
    return Boolean(config.host && config.serial && config.accessCode);
  }
  if (config.source === 'ha') {
    return Boolean(config.haUrl && config.haToken && config.haEntityState);
  }
  return false;
};
