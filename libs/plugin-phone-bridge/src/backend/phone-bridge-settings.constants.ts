import type { TunnelMode } from '@makekeeper/plugin-contract';

// Defaults for the phone-bridge settings singleton, shared by the settings
// service (read-through/write) and the exchange provider (backup import) so the
// two never drift on the row id, the fallback tunnel mode, or the idle TTL.

export const PHONE_BRIDGE_SETTINGS_ID = 'default';
export const DEFAULT_TUNNEL_MODE: TunnelMode = 'off';
export const DEFAULT_IDLE_TTL_MINUTES = 5;

// class-validator @MaxLength on the persisted tunnelMode string during import.
export const TUNNEL_MODE_MAX_LENGTH = 10;
