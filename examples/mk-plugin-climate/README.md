# mk-plugin-climate — workshop climate monitor

Watches temperature and humidity where materials are stored and warns when a
spot drifts out of spec for what lives there. Filament, resin, PCBs and cells
all have storage conditions; nobody tracks them because there is nowhere to
write them down.

This is the reference plugin written to be **installed**, not just read — and
it is deliberately the kind of thing that belongs outside the product: only
some workshops have sensors, and the core must never learn what Home Assistant
or MQTT are.

## How readings get in

Two intake paths, both dependency-free — configure either or both:

- **Pull from Home Assistant.** Set `HA_URL` and `HA_TOKEN` (a long-lived
  access token), then name the entity ids on each spot in the UI. Entities
  reporting `unavailable`/`unknown` are skipped, never recorded as zero.
- **Push from anything.** Set `CLIMATE_INGEST_TOKEN` and POST readings to the
  plugin's own route:

  ```bash
  curl -X POST "http://mk-plugin-climate:4405/ingest?token=$TOKEN" \
       -H 'content-type: application/json' \
       -d '{"spot":"Dry cabinet","temp":21.4,"humidity":38}'
  ```

  MQTT users bridge in one line:
  `mosquitto_sub -t workshop/rh | while read v; do curl … -d "{\"spot\":\"Dry cabinet\",\"humidity\":$v}"; done`

  This is a **plugin-owned public route** — the core's signature cannot apply
  to traffic the core did not send, so the plugin authenticates it itself.

## What it shows

Each **spot** is a sensor plus a **material profile** (PLA/PETG ≤40% RH, nylon
≤20%, resin ≤50% and 18–30 °C, electronics ≤60%, generic ≤65%), optionally
bound to a storage of your instance. The spot links straight to that storage,
so "the cupboard is damp" is one click from the cupboard's contents. A
dashboard widget and an agent tool (`climate_status`) round it out.

The storage picker is built from the core's own `list_storages` through the
`storages:read` grant — the plugin keeps no copy, so a renamed storage cannot
go stale here.

## Run it against a dev core

```bash
# core
MK_EXTERNAL_DEV=1 MK_EXTERNAL_DEV_TOKEN=dev-token nx serve backend

# plugin
MK_CORE_URL=http://localhost:3000 MK_INSTALL_TOKEN=dev-token \
CLIMATE_INGEST_TOKEN=dev-ingest npm start
```

Approve it once in **Settings → External plugins** (it asks for
`storages:read`), add a spot, then push a reading with the curl above.

## Install it for real

Generate an install token in the core, paste it into
[`compose.fragment.yml`](./compose.fragment.yml) together with your HA
credentials or an ingest token, add the service to your stack, start it and
approve the registration.
