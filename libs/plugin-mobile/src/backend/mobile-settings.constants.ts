// Defaults for the mobile settings singleton, shared by the settings service and
// the exchange provider so the two never drift on the row id or the fallbacks.

export const MOBILE_SETTINGS_ID = 'default';

// class-validator @MaxLength on the persisted origin, here and on import.
export const CUSTOM_ORIGIN_MAX_LENGTH = 255;

// How long a freshly started tunnel is held before its QR is shown. The same ten
// seconds the phone-bridge QR waits (`WARMUP_SECONDS` there) and for the same
// reason: the name exists before DNS agrees that it does.
export const TUNNEL_WARMUP_SECONDS = 10;
