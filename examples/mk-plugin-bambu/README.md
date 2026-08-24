# mk-plugin-bambu — Bambu Lab printer on your dashboard

Live state of a Bambu Lab printer (P1/X1/A1) and a log of finished prints, as
a screen, a dashboard widget and an assistant tool.

This is the archetypal external plugin: the core must never learn what a P1S
is — not its MQTT topics, not its firmware quirks, not its state vocabulary —
and a workshop without one should not carry the feature at all.

## Configuration lives in the UI

After pairing, open **Settings → Printer** and fill in the connection there:
the source (printer directly or Home Assistant), the address, the serial and
the access code. The plugin reconnects on save — no container restart.

The access code field is masked, is never rendered back, and a blank submit
keeps the stored value. Environment variables (`BAMBU_HOST`, `BAMBU_SERIAL`,
`BAMBU_ACCESS_CODE`, `HA_*`) still work as **defaults for a headless install**;
anything set in the UI wins from then on.

## How the page updates

The plugin pushes an invalidation to the core whenever something a viewer
would notice changes — the state, the percentage, the connection — and an open
page refetches on it. An idle printer produces none of that for hours, so the
page states how old the reading is and carries a **Refresh now** button that
asks the source out of turn (Home Assistant is polled immediately; the printer
is asked to push its full state).

The Home Assistant source polls every 15 s (`BAMBU_POLL_MS`); the LAN source
is push-driven and needs no interval.

## Which source to use

Two interchangeable sources, chosen in **Settings → Printer** (the environment
variables below are only defaults for a headless install).

| | When to use it | What it needs |
|---|---|---|
| **LAN (direct)** | No Home Assistant, or you want the printer's own data with no middleman | IP, serial, access code (`BAMBU_HOST`, `BAMBU_SERIAL`, `BAMBU_ACCESS_CODE`) |
| **Home Assistant** | HA already has the Bambu Lab integration | URL + token; the entities are discovered (`HA_URL`, `HA_TOKEN`, `HA_ENTITY_*`) |

**Can several things watch one printer at once?** Yes — Bambu Studio, the
Handy app, Home Assistant and this plugin are all just MQTT clients. But the
printer's broker accepts only a handful of concurrent connections, and going
over the limit shows up as everyone reconnecting in a loop rather than as a
clear error. So: **if Home Assistant already watches this printer, use the HA
source** and cost the printer nothing.

Two more facts worth knowing before you enable LAN Only Mode:

- LAN Only Mode **disables the cloud**: the Handy app loses remote access.
  Bambu Studio keeps working over the local network. You do *not* have to
  enable it — the local MQTT interface with the access code works in cloud mode
  too.
- The **access code changes** when you reset the printer's network settings.
  If the plugin suddenly cannot connect, that is the first thing to check.

## Where to get the Home Assistant entity ids

You do not. Fill in the **URL** and a **long-lived access token**, press
**Test connection**, and the plugin reads the entity list from Home Assistant,
recognises the printers in it and turns the six entity fields into dropdowns
with its suggestions already selected.

A typical install has several hundred entities and this plugin needs six of
them. Transcribing those by hand has a silent failure mode: a wrong id reads as
`unavailable`, which looks exactly like a printer that is switched off.

Only the **state** entity is required — anything left empty is simply not shown
on the card. If discovery recognises nothing (an integration with unusual
naming), the fields stay typeable, so nothing is lost.

The token comes from Home Assistant: your profile → **Security** → *Long-lived
access tokens* → **Create token**. It is shown once.

## Where to get the LAN credentials

On the printer: **Settings (gear) → WLAN**. That screen shows the **IP
address** and the **access code**; the **serial number** is on
**Settings → Device**, and also on the sticker under the machine.

## Try it temporarily (dev container, no compose changes)

For a one-off run against a printer — nothing added to any stack, nothing left
behind. The launcher builds the image, starts the container and prints the
pairing code, and if the container fails to start it prints the error instead
of a code:

```bash
# Can this machine even reach the printer? (no nc in most dev images)
node -e "require('node:net').connect(8883,'PRINTER_IP')\
  .on('connect',()=>{console.log('reachable');process.exit(0)})\
  .on('error',e=>{console.log('unreachable:',e.code);process.exit(1)})"

./examples/run-plugin.sh examples/mk-plugin-bambu --core http://localhost:3000
```

Then: open **Settings → External plugins → "Connect a plugin"**, type the code
on the card that appears, approve the permissions (this plugin asks for none),
and configure the printer in **Settings → Printer**. Order does not matter —
the container keeps announcing itself until someone opens the window.

Afterwards: uninstall it in the UI (that revokes its tokens), then

```bash
docker rm -f mk-plugin-bambu && docker volume rm mk-plugin-bambu-data
```

**Prefer to watch everything yourself?** Run it in the foreground and skip the
launcher — every message, including the pairing code, lands in your terminal:

```bash
docker network create makekeeper_default 2>/dev/null || true
docker run --rm --name mk-bambu --network makekeeper_default -p 127.0.0.1:4400:4400 \
  --add-host host.docker.internal:host-gateway \
  -e MK_CORE_URL=http://host.docker.internal:3000 \
  -e MK_PLUGIN_URL=http://localhost:4400 \
  -e PORT=4400 -v mk-bambu-data:/data mk-plugin-bambu
```

That is the dev-stack shape, where the core is `nx serve` outside the network:
the network is created first because nothing else has made it here, and the
port is published on `127.0.0.1` only — the core is the only thing that needs
to reach the plugin, and a bare `-p 4400:4400` would offer a third-party image
on every interface the machine has. Against the packaged stack the core is a
container on the network (which its stack already created), so drop the `-p`
and the `--add-host` and use `MK_CORE_URL=http://app:3000` with
`MK_PLUGIN_URL=http://mk-bambu:4400`.

With `-d` you get a container id instead — that is what `-d` means — and the
code goes to `docker logs`, where the banner is reprinted every minute so the
tail of the log always holds the current one.

## Run it for real, in a container

The examples import the SDK through this monorepo, so the image is built from
the repo root with a bundling stage:

```bash
docker build -f examples/Dockerfile --build-arg PLUGIN=mk-plugin-bambu \
             -t mk-plugin-bambu .
```

Then add the service from [`compose.fragment.yml`](./compose.fragment.yml) to
your stack and start it. **No install token is needed**: open *Connect a
plugin* in **Settings → External plugins**, and pair the container with the
four-digit code it prints to its own log:

```bash
docker logs mk-plugin-bambu | tail
```

The container connects to the printer immediately — it does not wait to be
paired, so it is already collecting by the time you approve it.

## What it does not do (yet)

**Filament deduction from inventory.** The plan was to subtract used filament
from a stock item on job completion, which is why it would need
`inventory:write`. It is deliberately not shipped: the P1 series does not
report per-job filament usage reliably, and inventing a number to write into
someone's stock is worse than not writing one. It lands once we have looked at
what a real P1S actually reports at the end of a print — until then the
plugin asks for **no permissions at all**.
