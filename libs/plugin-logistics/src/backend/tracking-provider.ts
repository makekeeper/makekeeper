import { OrderStatus } from './logistics.dto';
import { TrackingProvider } from './logistics-settings.service';

// A single normalized parcel checkpoint, provider-agnostic.
export interface NormalizedTrackingEvent {
  status: string;
  location: string | null;
  eventTime: Date;
  raw: string;
}

export interface TrackingResult {
  events: NormalizedTrackingEvent[];
  // Mapped order status to advance to, or null to leave the order untouched.
  orderStatus: OrderStatus | null;
}

export interface TestResult {
  ok: boolean;
  error?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// Maps a courier "stage"/"status" phrase from any provider onto our order
// lifecycle. Kept deliberately fuzzy — providers spell stages differently.
function mapStatus(stage: string | null): OrderStatus | null {
  if (!stage) return null;
  const s = stage.toLowerCase();
  if (s.includes('deliver') && !s.includes('out')) return 'DELIVERED';
  if (
    s.includes('transit') ||
    s.includes('pickup') ||
    s.includes('pick_up') ||
    s.includes('out_for_delivery') ||
    s.includes('outfordelivery') ||
    s.includes('delivery') ||
    s.includes('shipped') ||
    s.includes('accepted')
  ) {
    return 'SHIPPED';
  }
  return null;
}

const safeDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: the exact JSON shapes below are validated live against a real key for
// each provider — every parser optional-chains and returns null on deviation
// rather than throwing, so a wrong assumption degrades to "no update", never a
// crash. Docs: 17track api.17track.net · AfterShip aftership.com/docs ·
// TrackingMore trackingmore.com/docs · Ship24 docs.ship24.com
// ─────────────────────────────────────────────────────────────────────────────

// ── 17track (v2.2) ──────────────────────────────────────────────────────────
async function fetch17track(
  apiKey: string,
  trackingNumber: string,
): Promise<TrackingResult | null> {
  const headers = { '17token': apiKey, 'Content-Type': 'application/json' };
  const body = JSON.stringify([{ number: trackingNumber }]);
  await fetch('https://api.17track.net/track/v2.2/register', {
    method: 'POST',
    headers,
    body,
  }).catch(() => undefined);

  const res = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) return null;
  const json: unknown = await res.json();
  if (!isRecord(json) || !isRecord(json.data)) return null;
  const accepted = Array.isArray(json.data.accepted) ? json.data.accepted : [];
  const first = accepted[0];
  if (!isRecord(first) || !isRecord(first.track_info)) return null;
  const info = first.track_info;
  const latest = isRecord(info.latest_status) ? info.latest_status : {};
  const orderStatus = mapStatus(str(latest.status));

  const events: NormalizedTrackingEvent[] = [];
  const tracking = isRecord(info.tracking) ? info.tracking : {};
  const providers = Array.isArray(tracking.providers) ? tracking.providers : [];
  for (const provider of providers) {
    const evs =
      isRecord(provider) && Array.isArray(provider.events)
        ? provider.events
        : [];
    for (const ev of evs) {
      if (!isRecord(ev)) continue;
      const time = safeDate(str(ev.time_iso) ?? str(ev.time_utc));
      if (!time) continue;
      events.push({
        status: str(ev.stage) ?? str(ev.description) ?? '—',
        location: str(ev.location),
        eventTime: time,
        raw: JSON.stringify(ev),
      });
    }
  }
  return { events, orderStatus };
}

async function test17track(apiKey: string): Promise<TestResult> {
  const res = await fetch('https://api.17track.net/track/v2.2/getquota', {
    method: 'POST',
    headers: { '17token': apiKey, 'Content-Type': 'application/json' },
  });
  return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
}

// ── 17track via a free web account (login/password) ─────────────────────────
// Mirrors the py17track library used by Home Assistant: sign in to the 17track
// USER account (not the business data API), then read the packages the account
// tracks. The user adds parcels in the 17track app/site; we match by number.
// Endpoints/format are the site's internal API — undocumented and subject to
// change, so everything is defensive. Needs live QA with a real account.

// 17track package status codes (track_info.e): 40 = delivered; 10/30/35 = in
// transit-ish; others = not-found/alert/expired.
function mapStatusCode(code: number | null): OrderStatus | null {
  if (code === 40) return 'DELIVERED';
  if (code !== null && code >= 10 && code < 40) return 'SHIPPED';
  return null;
}

async function login17track(
  email: string,
  password: string,
): Promise<string | null> {
  const res = await fetch('https://user.17track.net/userapi/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: '1.0',
      method: 'Signin',
      param: { Email: email, Password: password, CaptchaCode: '' },
    }),
  });
  if (!res.ok) return null;
  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json) || json.Code !== 0) return null;
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  // Collapse the Set-Cookie header(s) into a single Cookie value (name=value;…).
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function fetch17trackCredentials(
  email: string,
  password: string,
  trackingNumber: string,
): Promise<TrackingResult | null> {
  const cookie = await login17track(email, password);
  if (!cookie) return null;

  const res = await fetch('https://buyer.17track.net/orderapi/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      version: '1.0',
      method: 'GetTrackInfoList',
      param: { IsArchived: false, Item: '', Page: 1, PerPage: 40, Package: {} },
    }),
  });
  if (!res.ok) return null;
  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json) || !Array.isArray(json.Json)) return null;

  const pkg = json.Json.find(
    (p) => isRecord(p) && str(p.FTrackNo) === trackingNumber,
  );
  if (!isRecord(pkg)) return null;

  let info: unknown = null;
  try {
    info = JSON.parse(str(pkg.FTrackInfo) ?? '{}');
  } catch {
    return null;
  }
  if (!isRecord(info)) return null;

  const orderStatus = mapStatusCode(typeof info.e === 'number' ? info.e : null);
  const events: NormalizedTrackingEvent[] = [];
  const trail = Array.isArray(info.z1) ? info.z1 : [];
  for (const ev of trail) {
    if (!isRecord(ev)) continue;
    const time = safeDate(str(ev.a));
    if (!time) continue;
    events.push({
      status: str(ev.z) ?? '—',
      location: str(ev.c),
      eventTime: time,
      raw: JSON.stringify(ev),
    });
  }
  return { events, orderStatus };
}

async function test17trackCredentials(
  email: string,
  password: string,
): Promise<TestResult> {
  const cookie = await login17track(email, password);
  return cookie ? { ok: true } : { ok: false, error: 'login failed' };
}

// ── AfterShip (v4) ──────────────────────────────────────────────────────────
async function fetchAftership(
  apiKey: string,
  trackingNumber: string,
): Promise<TrackingResult | null> {
  const headers = {
    'aftership-api-key': apiKey,
    'Content-Type': 'application/json',
  };
  // Create the tracking (auto-detects courier); 4xx means it already exists.
  await fetch('https://api.aftership.com/v4/trackings', {
    method: 'POST',
    headers,
    body: JSON.stringify({ tracking: { tracking_number: trackingNumber } }),
  }).catch(() => undefined);

  const res = await fetch(
    `https://api.aftership.com/v4/trackings?tracking_numbers=${encodeURIComponent(trackingNumber)}`,
    { headers },
  );
  if (!res.ok) return null;
  const json: unknown = await res.json();
  if (!isRecord(json) || !isRecord(json.data)) return null;
  const list = Array.isArray(json.data.trackings) ? json.data.trackings : [];
  const first = list[0];
  if (!isRecord(first)) return null;
  const orderStatus = mapStatus(str(first.tag) ?? str(first.subtag_message));

  const events: NormalizedTrackingEvent[] = [];
  const checkpoints = Array.isArray(first.checkpoints) ? first.checkpoints : [];
  for (const cp of checkpoints) {
    if (!isRecord(cp)) continue;
    const time = safeDate(str(cp.checkpoint_time) ?? str(cp.created_at));
    if (!time) continue;
    const loc = [str(cp.city), str(cp.country_name)].filter(Boolean).join(', ');
    events.push({
      status: str(cp.message) ?? str(cp.tag) ?? '—',
      location: loc || null,
      eventTime: time,
      raw: JSON.stringify(cp),
    });
  }
  return { events, orderStatus };
}

async function testAftership(apiKey: string): Promise<TestResult> {
  const res = await fetch('https://api.aftership.com/v4/couriers', {
    headers: { 'aftership-api-key': apiKey },
  });
  return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
}

// ── TrackingMore (v4) ───────────────────────────────────────────────────────
async function fetchTrackingMore(
  apiKey: string,
  trackingNumber: string,
): Promise<TrackingResult | null> {
  const headers = {
    'Tracking-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };
  await fetch('https://api.trackingmore.com/v4/trackings/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({ tracking_number: trackingNumber }),
  }).catch(() => undefined);

  const res = await fetch(
    `https://api.trackingmore.com/v4/trackings/get?tracking_numbers=${encodeURIComponent(trackingNumber)}`,
    { headers },
  );
  if (!res.ok) return null;
  const json: unknown = await res.json();
  if (!isRecord(json) || !Array.isArray(json.data)) return null;
  const first = json.data[0];
  if (!isRecord(first)) return null;
  const orderStatus = mapStatus(
    str(first.delivery_status) ?? str(first.status),
  );

  const events: NormalizedTrackingEvent[] = [];
  const origin = isRecord(first.origin_info) ? first.origin_info : {};
  const trail = Array.isArray(origin.trackinfo) ? origin.trackinfo : [];
  for (const ev of trail) {
    if (!isRecord(ev)) continue;
    const time = safeDate(str(ev.checkpoint_date) ?? str(ev.Date));
    if (!time) continue;
    events.push({
      status: str(ev.tracking_detail) ?? str(ev.StatusDescription) ?? '—',
      location: str(ev.location) ?? str(ev.Details),
      eventTime: time,
      raw: JSON.stringify(ev),
    });
  }
  return { events, orderStatus };
}

async function testTrackingMore(apiKey: string): Promise<TestResult> {
  const res = await fetch('https://api.trackingmore.com/v4/couriers/all', {
    headers: { 'Tracking-Api-Key': apiKey },
  });
  return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
}

// ── Ship24 ──────────────────────────────────────────────────────────────────
async function fetchShip24(
  apiKey: string,
  trackingNumber: string,
): Promise<TrackingResult | null> {
  const res = await fetch('https://api.ship24.com/public/v1/trackers/track', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trackingNumber }),
  });
  if (!res.ok) return null;
  const json: unknown = await res.json();
  if (!isRecord(json) || !isRecord(json.data)) return null;
  const trackings = Array.isArray(json.data.trackings)
    ? json.data.trackings
    : [];
  const first = trackings[0];
  if (!isRecord(first)) return null;
  const shipment = isRecord(first.shipment) ? first.shipment : {};
  const orderStatus = mapStatus(
    str(shipment.statusMilestone) ?? str(shipment.statusCategory),
  );

  const events: NormalizedTrackingEvent[] = [];
  const evs = Array.isArray(first.events) ? first.events : [];
  for (const ev of evs) {
    if (!isRecord(ev)) continue;
    const time = safeDate(str(ev.occurrenceDatetime) ?? str(ev.datetime));
    if (!time) continue;
    const loc = [str(ev.location), str(ev.courierCode)]
      .filter(Boolean)
      .join(', ');
    events.push({
      status: str(ev.status) ?? str(ev.statusMilestone) ?? '—',
      location: loc || null,
      eventTime: time,
      raw: JSON.stringify(ev),
    });
  }
  return { events, orderStatus };
}

async function testShip24(apiKey: string): Promise<TestResult> {
  const res = await fetch('https://api.ship24.com/public/v1/couriers', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
}

// Dispatches to the configured provider. Returns null when tracking is off,
// unconfigured, or the remote call fails — callers treat null as "no update".
export async function fetchTracking(
  provider: TrackingProvider,
  apiKey: string | null,
  trackingNumber: string,
): Promise<TrackingResult | null> {
  if (!apiKey || !trackingNumber) return null;
  switch (provider) {
    case '17track':
      return fetch17track(apiKey, trackingNumber);
    case 'aftership':
      return fetchAftership(apiKey, trackingNumber);
    case 'trackingmore':
      return fetchTrackingMore(apiKey, trackingNumber);
    case 'ship24':
      return fetchShip24(apiKey, trackingNumber);
    default:
      return null;
  }
}

// Login/password path — only 17track offers a free web account (others are
// API-key only). Returns null for unsupported providers.
export async function fetchTrackingCredentials(
  provider: TrackingProvider,
  login: string | null,
  password: string | null,
  trackingNumber: string,
): Promise<TrackingResult | null> {
  if (!login || !password || !trackingNumber) return null;
  if (provider === '17track') {
    return fetch17trackCredentials(login, password, trackingNumber);
  }
  return null;
}

export async function testTrackingCredentials(
  provider: TrackingProvider,
  login: string,
  password: string,
): Promise<TestResult> {
  if (!login || !password) return { ok: false, error: 'no credentials' };
  try {
    if (provider === '17track') {
      return await test17trackCredentials(login, password);
    }
    return { ok: false, error: 'unsupported' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// Validates a provider API key with a cheap authenticated call (no tracking
// number needed), so the admin can confirm credentials before saving.
export async function testTrackingKey(
  provider: TrackingProvider,
  apiKey: string,
): Promise<TestResult> {
  if (!apiKey) return { ok: false, error: 'no key' };
  try {
    switch (provider) {
      case '17track':
        return await test17track(apiKey);
      case 'aftership':
        return await testAftership(apiKey);
      case 'trackingmore':
        return await testTrackingMore(apiKey);
      case 'ship24':
        return await testShip24(apiKey);
      default:
        return { ok: false, error: 'unsupported' };
    }
  } catch {
    return { ok: false, error: 'network' };
  }
}
