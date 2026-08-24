// PUSH source: the plugin's own HTTP route.
//
// A plugin-owned PUBLIC route (#141): core→plugin calls are HMAC-signed, but a
// sensor pushing a reading is not the core and could never produce that
// signature — the key is shared with the CORE. So this route is unsigned and
// authenticates itself with a token of its own.
//
// Anything can feed it:
//   mosquitto_sub -t workshop/rh | while read v; do
//     curl -X POST "$URL/ingest?token=$T" -d "{\"spot\":\"Dry cabinet\",\"humidity\":$v}"
//   done

import type { PublicRouteRequest, PublicRouteResponse } from '@makekeeper/plugin-sdk';
import {
  findSpot,
  isOutOfSpec,
  recordReading,
  saveState,
  type State,
} from '../state.ts';

const INGEST_TOKEN = process.env['CLIMATE_INGEST_TOKEN'] ?? '';

interface IngestBody {
  spot?: string;
  temp?: number;
  humidity?: number;
}

export const makeIngestRoute =
  (state: State, onVerdictChanged: () => Promise<void>) =>
  async (req: PublicRouteRequest): Promise<PublicRouteResponse> => {
    // No token configured means the push path is switched off entirely, not
    // open — a missing secret must never read as "no authentication needed".
    if (!INGEST_TOKEN || req.query.get('token') !== INGEST_TOKEN) {
      return { status: 401, body: { error: 'bad-token' } };
    }
    let body: IngestBody;
    try {
      body = JSON.parse(req.rawBody || '{}') as IngestBody;
    } catch {
      return { status: 400, body: { error: 'bad-json' } };
    }
    const spot = findSpot(state, String(body.spot ?? ''));
    if (!spot) return { status: 404, body: { error: 'unknown-spot' } };

    const before = isOutOfSpec(spot);
    recordReading(
      spot,
      typeof body.temp === 'number' ? body.temp : null,
      typeof body.humidity === 'number' ? body.humidity : null,
    );
    const now = isOutOfSpec(spot);
    await saveState(state);
    if (now !== before) await onVerdictChanged();
    return { status: 200, body: { ok: true, outOfSpec: now } };
  };
