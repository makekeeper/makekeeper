import { defineStore } from 'pinia';
import { computed, ref, watch, type Ref } from 'vue';
import { apiFetch } from './api';
import { useRealtime } from './realtime';

// Backend availability monitor (#64). A single source of truth the app shell
// uses to lock the UI behind an offline notice the moment the backend becomes
// unreachable, and to release it automatically once it answers again.
//
// The shared socket.io connection (#61) is the PRIMARY signal, not a mere hint:
// in the healthy steady state (backend up + socket connected) we do NOT poll
// `/api/health` at all — the socket's own `disconnect` is what tells us the
// backend went away, instantly and for free. HTTP probing kicks in only when
// there is no live socket to trust: the initial boot race, and while we are
// offline waiting for recovery. This keeps `/api/health` traffic near zero in
// normal operation instead of a constant heartbeat.
//
// Why HTTP still has the final say on "is it *ready*": `/api/health` answers
// only after NestFactory's `app.listen()`, which runs once every module has
// initialized — so a 200 means the backend is *fully* started, not merely
// accepting sockets. nginx serves the SPA independently of the API, so the page
// can load while the backend is still booting; the socket may even connect
// before the API finishes init. We therefore never flip to `online` on a socket
// connect alone — a probe must return 200 first — but once online, a connected
// socket lets us stop polling.
export type BackendAvailability =
  | 'connecting'
  | 'online'
  | 'offline'
  | 'reconnecting';

const HEALTH_PATH = '/api/health';
// Fallback HTTP heartbeat used ONLY when there is no connected socket to lean on
// (e.g. a page that never opened one). With a live socket we don't poll at all
// while healthy — the socket's disconnect is the outage signal — so this is a
// safety net, not the normal cadence.
const HEALTHY_INTERVAL_MS = 15_000;
// Fast retry while we're offline / socket-down, so recovery is caught quickly.
const OFFLINE_INTERVAL_MS = 3_000;
// A hung request (dead TCP, no RST) must resolve to "offline" rather than
// stalling the probe loop forever — abort it and treat it as a failure.
const PROBE_TIMEOUT_MS = 8_000;

export const useAvailabilityStore = defineStore('availability', () => {
  // Pessimistic start: the UI stays locked until the first successful probe
  // confirms the backend is up. `connecting` (vs `offline`) lets the overlay
  // show reassuring "starting up" copy on first load instead of an alarming
  // "connection lost".
  const status = ref<BackendAvailability>('connecting');
  // True once we've seen at least one healthy response — flips the overlay copy
  // from "connecting" to "connection lost" and marks that a later recovery is a
  // genuine reconnect rather than the initial handshake.
  const everOnline = ref(false);
  // Bumped every time the backend comes back after a failed probe (the initial
  // "backend was still booting when the page loaded" race included). The shell
  // watches this to re-run its bootstrap so a page that first loaded against a
  // down/half-started backend ends up with correct session + plugin state.
  const recoveryTick = ref(0);

  // The overlay shows for the initial handshake, a settled outage and an
  // in-flight retry alike — anything but a confirmed-healthy backend.
  const isOffline = computed<boolean>(() => status.value !== 'online');

  let timer: ReturnType<typeof setTimeout> | null = null;
  let probing = false;
  let started = false;
  // Whether a probe has failed since the last healthy response. Distinguishes a
  // normal first-load confirm (no prior failure → no recovery) from a real
  // reconnect (a failure preceded this success → refresh app state).
  let hadFailure = false;
  // The shared socket's live-connection ref, captured in start(). When it's
  // connected and we're online, the socket is our outage signal and we skip the
  // HTTP heartbeat entirely.
  let socketConnected: Ref<boolean> | null = null;

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    // Socket-primary steady state: backend confirmed up AND socket connected ⇒
    // no HTTP polling. The watch on the socket (see start()) fires a probe the
    // instant it disconnects, which is when we start polling again. This is what
    // keeps `/api/health` quiet during normal use.
    if (status.value === 'online' && socketConnected?.value) return;
    const delay =
      status.value === 'online' ? HEALTHY_INTERVAL_MS : OFFLINE_INTERVAL_MS;
    timer = setTimeout(() => void probe(), delay);
  };

  const markOnline = (): void => {
    const recovered = hadFailure;
    hadFailure = false;
    status.value = 'online';
    everOnline.value = true;
    // Signal the shell to re-bootstrap only when this is a recovery from a
    // failure (initial boot race or mid-session drop), not the happy-path
    // first confirm where the pre-mount bootstrap already succeeded.
    if (recovered) recoveryTick.value += 1;
  };

  const markOffline = (): void => {
    hadFailure = true;
    // Keep showing "connecting" until we've ever been online; only downgrade to
    // the "lost" wording after a real connection existed.
    status.value = everOnline.value ? 'offline' : 'connecting';
  };

  const probe = async (): Promise<void> => {
    // Guard against overlapping probes (a socket hint firing mid-request).
    if (probing) return;
    probing = true;
    // Reflect an in-flight retry once we're past the first handshake.
    if (status.value === 'offline') status.value = 'reconnecting';

    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await apiFetch(HEALTH_PATH, {
        public: true,
        signal: controller.signal,
      });
      if (response.ok) markOnline();
      else markOffline();
    } catch {
      // Network error / abort ⇒ backend unreachable.
      markOffline();
    } finally {
      clearTimeout(abort);
      probing = false;
      schedule();
    }
  };

  // Force an immediate check (the overlay's "retry now" button, or a socket
  // connect/disconnect hint) without waiting for the next scheduled tick.
  const checkNow = (): void => {
    void probe();
  };

  // Begin monitoring. Idempotent — the app shell calls it once on mount.
  const start = (): void => {
    if (started) return;
    started = true;
    // Socket state changes are the primary availability signal. We confirm each
    // with an HTTP probe (a connect can precede full backend init; a disconnect
    // could be a blip), but a steady connected socket lets schedule() stop
    // polling entirely.
    const { connected } = useRealtime();
    socketConnected = connected;
    watch(connected, () => void probe());
    void probe();
  };

  return { status, isOffline, everOnline, recoveryTick, start, checkNow };
});
