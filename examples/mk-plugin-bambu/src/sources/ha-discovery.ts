// Finding the printer's entities in Home Assistant, instead of asking a human
// to find them.
//
// A HA install has hundreds of entities; a printer contributes a couple of
// dozen, and this plugin needs six of them. Typing those ids by hand is a
// transcription exercise with a silent failure mode — a wrong id reads as
// `unavailable`, which looks exactly like a printer that is switched off.
//
// So: read the state list once (one REST call the token already allows), find
// the printers in it, and propose the mapping. The admin confirms rather than
// composes. Nothing here is authoritative — the integration renames things
// between versions, which is why every suggestion stays an editable choice.

// The metrics this plugin reads, each with the id endings the Bambu Lab
// integration has used, most specific first. Suffix matching (not exact ids)
// is what survives both the integration's renames and a printer whose device
// name contains an underscore.
export const HA_METRICS = {
  haEntityState: ['_print_status', '_current_stage', '_stage', '_status'],
  haEntityProgress: ['_print_progress', '_progress'],
  haEntityRemaining: ['_remaining_time', '_time_remaining', '_remaining'],
  haEntityNozzle: ['_nozzle_temperature', '_nozzle_temp'],
  haEntityBed: ['_bed_temperature', '_bed_temp'],
  haEntityJob: ['_task_name', '_print_name', '_current_task', '_job_name'],
} as const;

export type HaMetric = keyof typeof HA_METRICS;

export const HA_METRIC_NAMES = Object.keys(HA_METRICS) as HaMetric[];

const baseUrl = (url: string): string => url.replace(/\/+$/, '');

// One call, one failure message. The message is shown to the admin, so it says
// what actually went wrong — a 401 is a bad token, a 404 is the wrong path, a
// refused connection is the wrong host — rather than "could not connect".
export const fetchEntityIds = async (
  url: string,
  token: string,
): Promise<string[]> => {
  const res = await fetch(`${baseUrl(url)}/api/states`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as Array<{ entity_id?: unknown }>;
  if (!Array.isArray(payload)) throw new Error('unexpected response');
  return payload
    .map((row) => row.entity_id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
};

// How many distinct metrics one prefix can fill — the measure of "this looks
// like a printer" rather than "this ends in _status".
const score = (entityIds: readonly string[], prefix: string): number =>
  HA_METRIC_NAMES.filter((metric) =>
    entityIds.some(
      (id) =>
        id.startsWith(`${prefix}_`) &&
        HA_METRICS[metric].some((suffix) => id.endsWith(suffix)),
    ),
  ).length;

// A printer is identified by whatever carries its STATE: that entity must
// exist for the source to work at all, and its prefix names the device.
//
// Two filters keep the list short enough to choose from. Cutting a suffix off
// an id yields near-misses (`sensor.p1s_print_status` yields both `sensor.p1s`
// and `sensor.p1s_print`), so a prefix that merely extends another one is
// dropped — the shorter prefix owns strictly more entities. And a device that
// can fill only ONE metric is something else with a `_status` entity, of which
// a real HA install has many.
export const detectPrinters = (entityIds: readonly string[]): string[] => {
  const candidates = new Set<string>();
  for (const id of entityIds) {
    for (const suffix of HA_METRICS.haEntityState) {
      if (id.endsWith(suffix)) candidates.add(id.slice(0, -suffix.length));
    }
  }
  return [...candidates]
    .filter(
      (prefix) =>
        ![...candidates].some(
          (other) => other !== prefix && prefix.startsWith(`${other}_`),
        ) && score(entityIds, prefix) >= 2,
    )
    .sort();
};

// Every entity belonging to one device, in id order — the options offered per
// metric, so a wrong guess is corrected with a dropdown and not a keyboard.
export const entitiesOf = (
  entityIds: readonly string[],
  prefix: string,
): string[] => entityIds.filter((id) => id.startsWith(`${prefix}_`));

// The proposed mapping for one printer. A metric with no match is left empty
// rather than filled with something plausible: an empty field reads as "not
// available", a wrong one reads as a broken printer.
export const suggestMapping = (
  entityIds: readonly string[],
  prefix: string,
): Record<HaMetric, string> => {
  const own = entitiesOf(entityIds, prefix);
  const pick = (suffixes: readonly string[]): string => {
    for (const suffix of suffixes) {
      const found = own.find((id) => id.endsWith(suffix));
      if (found) return found;
    }
    return '';
  };
  return {
    haEntityState: pick(HA_METRICS.haEntityState),
    haEntityProgress: pick(HA_METRICS.haEntityProgress),
    haEntityRemaining: pick(HA_METRICS.haEntityRemaining),
    haEntityNozzle: pick(HA_METRICS.haEntityNozzle),
    haEntityBed: pick(HA_METRICS.haEntityBed),
    haEntityJob: pick(HA_METRICS.haEntityJob),
  };
};

// Which printer a stored mapping belongs to, so a screen reopened later shows
// the device that is actually configured rather than the first one found.
export const printerOfMapping = (
  stateEntity: string,
): string => {
  for (const suffix of HA_METRICS.haEntityState) {
    if (stateEntity.endsWith(suffix)) return stateEntity.slice(0, -suffix.length);
  }
  return '';
};
