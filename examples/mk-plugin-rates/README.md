# mk-plugin-rates — currency rates, offered to the whole instance

Keeps a fresh copy of exchange rates and offers `rates.convert` as a
capability, so any other plugin converts money without knowing where the
numbers come from.

## The source: Frankfurter **v2**

165 currencies — the ISO set, including RUB, UAH and RSD — with history by
date, free and keyless.

The version matters more than it looks. `v1` (and the older
`api.frankfurter.app`) serves the **ECB's daily reference rates**: thirty
currencies, no RUB since 2022, no UAH, no RSD. Same host, same-looking path,
an entirely different answer to "which currencies exist".

The response shape changed with it: v1 returned one object with a `rates` map,
v2 returns **one row per quote** (`{date, base, quote, rate}`). Parsing v2 with
v1's expectations yields an empty table rather than an error — the kind of
failure that reaches production quietly.

## Settings

- **Base currency** — rates are quoted against it and every conversion goes
  through it. Changing it re-fetches: every cached number was quoted against
  the old base, so the cache is not stale, it is wrong.
- **Update automatically** and **every N hours** (1–168, six by default).
- **Update now**, independent of both.

The picker is built from what the API publishes, with the API's own English
currency names — they are data about currencies, not our interface text, and
inventing translations for 165 of them would be worse than showing the
canonical name next to the ISO code.

A failed update keeps the previous rates and says when the attempt failed: a
rate a few hours old converts, an exception takes out every consumer's screen.

Environment variables (`RATES_API`, `RATES_BASE`, `RATES_AUTO`,
`RATES_REFRESH_HOURS`) stay as defaults for a headless install; anything set in
the UI wins from then on.

## Run it

```bash
./examples/run-plugin.sh examples/mk-plugin-rates --core http://localhost:3000
npm --prefix examples/mk-plugin-rates test
```
