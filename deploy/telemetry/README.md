# Liveness-telemetry receiver

The other half of opt-in liveness telemetry (#343): a Cloudflare Worker over a
D1 database that records **one row per instance** — first contact, last contact,
version, install method, enabled plugins, language. Nothing else, and no history
of pings.

It exists to answer one question: how many instances are still alive at 7 and at
30 days. That number is what epic #336 is judged by, and the repository could
not answer it.

## Why it lives in this repository

The payload is a contract with two ends. `libs/plugin-contract/src/lib/telemetry.ts`
declares what an instance sends, this worker declares what the receiver accepts,
and a test (`apps/backend/src/app/telemetry/telemetry-docs.spec.ts`) holds them
and `INSTALL.md` to the same field list. Kept in separate repositories they would
drift within a release.

## Deploy

```bash
cd deploy/telemetry
npx wrangler d1 create makekeeper-telemetry     # copy the id into wrangler.toml
npx wrangler d1 execute makekeeper-telemetry --remote --file schema.sql
npx wrangler deploy
```

Then point `ping.makekeeper.app` at the worker (Workers → Triggers → Custom
domain). That hostname is the app's built-in default; an instance can be sent
elsewhere, or silenced entirely, with `MK_TELEMETRY_ENDPOINT`.

## Read the numbers

```bash
npx wrangler d1 execute makekeeper-telemetry --remote --file queries.sql
```

## What this cannot tell you

- **Anything an instance did not consent to sending.** Consent is off by
  default and the sender is the only thing that decides.
- **A representative picture.** Two biases stack: `MK_INSTALL_METHOD` is only
  stamped by recent deployments (older ones report `unknown`), and only those
  who agreed appear at all. It ranks; it does not measure.
- **Truth about a specific row.** The endpoint takes no credential — one could
  not be kept secret in a self-hosted client anyway — so rows can be forged.
  Rate limiting makes it tedious, not impossible.
