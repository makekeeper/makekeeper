// The domain: what a printer report means, and what is worth remembering.
//
// Both sources (LAN MQTT and Home Assistant) normalise into `PrinterStatus`,
// so the screens never learn which one is configured — adding a third source
// later is a file, not a rewrite.

export type PrintState =
  | 'idle'
  | 'printing'
  | 'paused'
  | 'finished'
  | 'failed'
  | 'unknown';

export interface PrinterStatus {
  state: PrintState;
  // Human name of what is printing, when the printer reports one.
  job: string | null;
  percent: number | null;
  // Minutes the printer thinks are left.
  remainingMinutes: number | null;
  layer: number | null;
  totalLayers: number | null;
  nozzleTempC: number | null;
  bedTempC: number | null;
  at: string;
}

export const emptyStatus = (): PrinterStatus => ({
  state: 'unknown',
  job: null,
  percent: null,
  remainingMinutes: null,
  layer: null,
  totalLayers: null,
  nozzleTempC: null,
  bedTempC: null,
  at: new Date().toISOString(),
});

// Bambu reports `gcode_state` as one of RUNNING / IDLE / PAUSE / FINISH /
// FAILED (and occasionally PREPARE / SLICING). Anything unrecognised stays
// `unknown` rather than being guessed into a state the UI would act on.
const STATE_MAP: Record<string, PrintState> = {
  RUNNING: 'printing',
  PREPARE: 'printing',
  SLICING: 'printing',
  IDLE: 'idle',
  PAUSE: 'paused',
  FINISH: 'finished',
  FAILED: 'failed',
};

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

// The printer sends DELTAS: a report may carry only the fields that changed,
// so each one is merged onto the last known status instead of replacing it.
// Treating a delta as a full snapshot is how a progress bar ends up jumping
// back to zero mid-print.
export const mergeReport = (
  previous: PrinterStatus,
  report: Record<string, unknown>,
): PrinterStatus => {
  const print = report['print'];
  if (typeof print !== 'object' || print === null) return previous;
  const p = print as Record<string, unknown>;

  const gcodeState =
    typeof p['gcode_state'] === 'string' ? p['gcode_state'] : null;
  const job =
    typeof p['subtask_name'] === 'string' && p['subtask_name']
      ? p['subtask_name']
      : typeof p['gcode_file'] === 'string' && p['gcode_file']
        ? p['gcode_file']
        : null;

  return {
    state: gcodeState ? (STATE_MAP[gcodeState] ?? 'unknown') : previous.state,
    job: job ?? previous.job,
    percent: num(p['mc_percent']) ?? previous.percent,
    remainingMinutes: num(p['mc_remaining_time']) ?? previous.remainingMinutes,
    layer: num(p['layer_num']) ?? previous.layer,
    totalLayers: num(p['total_layer_num']) ?? previous.totalLayers,
    nozzleTempC: num(p['nozzle_temper']) ?? previous.nozzleTempC,
    bedTempC: num(p['bed_temper']) ?? previous.bedTempC,
    at: new Date().toISOString(),
  };
};

export interface PrintLogEntry {
  job: string;
  outcome: 'finished' | 'failed';
  startedAt: string | null;
  endedAt: string;
}

// A job is logged on the TRANSITION into a terminal state, not on every report
// that happens to say FINISH — the printer keeps repeating its last state.
export const jobEnded = (
  previous: PrintState,
  next: PrintState,
): 'finished' | 'failed' | null => {
  if (previous === next) return null;
  if (next === 'finished') return 'finished';
  if (next === 'failed') return 'failed';
  return null;
};
