// A Home Assistant that is not one: enough of its REST API to exercise the
// whole #364 path from the real UI, plus the hass-niimbot `print` action.
//
// It writes every rendered label to disk, so a label printed "through Home
// Assistant" can be compared with the dialog's own preview by eye — the one
// check no unit test performs.
//
//   node ha-stub.mjs [--port 8123] [--token devtoken] [--fail 401|400|hang|nodevices]
//
// The failure flags exist so each branch of the error taxonomy is reachable
// from the settings screen, not only from a spec.

import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(arg('port', '8123'));
const TOKEN = arg('token', 'devtoken');
const FAIL = arg('fail', '');
const OUT = arg('out', '/tmp/ha-stub-labels');
mkdirSync(OUT, { recursive: true });

const ENTITIES = [
  {
    entity_id: 'button.workshop_b1_print',
    state: 'idle',
    attributes: { friendly_name: 'Workshop B1' },
  },
  {
    entity_id: 'sensor.workshop_b1_battery',
    state: '80',
    attributes: { friendly_name: 'Workshop B1 Battery' },
  },
  {
    entity_id: 'light.kitchen',
    state: 'on',
    attributes: { friendly_name: 'Kitchen' },
  },
];
// One printer, a dozen entities — which is exactly why the picker asks for
// devices: a list of entities offers "Niimbot B1 RFID" as if it printed.
const DEVICES = [{ id: 'dev-b1', name: 'Niimbot B1' }];

const NIIMBOT_ENTITIES = ENTITIES.filter((e) =>
  e.entity_id.includes('workshop_b1'),
).map((e) => e.entity_id);

const body = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

const send = (res, status, payload) => {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
};

let printed = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (FAIL === 'hang') return; // never answers: exercises the timeout branch

  // Authentication is checked first and for every route, as the real one does:
  // a stub that always says 200 hides exactly the integration bug it exists to
  // catch.
  const auth = req.headers.authorization ?? '';
  if (FAIL === '401' || auth !== `Bearer ${TOKEN}`) {
    console.log(`401 ${req.method} ${path}`);
    return send(res, 401, { message: 'Unauthorized' });
  }

  if (path === '/api/' && req.method === 'GET') {
    return send(res, 200, { message: 'API running.' });
  }

  if (path === '/api/config' && req.method === 'GET') {
    return send(res, 200, {
      version: '2026.10.1',
      location_name: 'Stub',
      components: ['http', 'api', 'niimbot'],
    });
  }

  if (path === '/api/states' && req.method === 'GET') {
    return send(res, 200, ENTITIES);
  }

  if (path === '/api/template' && req.method === 'POST') {
    const { template = '' } = await body(req);
    if (!template.includes('integration_entities')) {
      return send(res, 400, 'unsupported template');
    }
    // The endpoint renders to TEXT, which is why the caller asks for `tojson`.
    res.writeHead(200, { 'content-type': 'text/plain' });
    // The device walk (`device_id` + `device_attr`) and the plain entity list
    // are two different questions through the same endpoint.
    if (template.includes('device_id')) {
      if (FAIL === 'nodevices') return res.end('[]');
      return res.end(JSON.stringify(DEVICES));
    }
    return res.end(JSON.stringify(NIIMBOT_ENTITIES));
  }

  if (path === '/api/services/niimbot/print' && req.method === 'POST') {
    if (FAIL === '400') {
      return send(res, 400, { message: 'Service niimbot.print not found.' });
    }
    const payload = await body(req);
    const element = (payload.payload ?? [])[0] ?? {};
    const url64 = String(element.url ?? '');
    const base64 = url64.slice(url64.indexOf(',') + 1);
    const file = join(
      OUT,
      `label-${String(++printed).padStart(3, '0')}${payload.preview ? '-preview' : ''}.png`,
    );
    if (base64) writeFileSync(file, Buffer.from(base64, 'base64'));
    console.log(
      `print target=${payload.entity_id ?? '(none)'} ` +
        `canvas=${payload.width ?? '-'}x${payload.height ?? '-'} ` +
        `element=${element.xsize ?? '-'}x${element.ysize ?? '-'} ` +
        `density=${payload.density} label_type=${payload.label_type} ` +
        `copies=${payload.copies ?? 1} preview=${payload.preview === true} ` +
        `→ ${file}`,
    );
    // The real action answers with the rendered image when asked; without
    // `?return_response` Home Assistant answers with the changed states.
    if (url.searchParams.has('return_response')) {
      return send(res, 200, {
        changed_states: [],
        service_response: { image: `data:image/png;base64,${base64}` },
      });
    }
    return send(res, 200, []);
  }

  console.log(`404 ${req.method} ${path}`);
  send(res, 404, { message: 'Not found' });
});

server.listen(PORT, () => {
  console.log(
    `HA stub on http://localhost:${PORT} (token "${TOKEN}", labels in ${OUT}${FAIL ? `, forcing ${FAIL}` : ''})`,
  );
});
