# mk-plugin-shelf — reference MakeKeeper external plugin

A shelf-life tracker: batches of materials that expire (resin, glue, batteries,
filament with a shelf life). The core's inventory knows *how much* you have;
this plugin knows *when it goes bad* — the honest shape of a third-party
plugin, adding a dimension the product does not have and linking back to the
objects it does.

It is the worked example for [`docs/external-plugins.md`](../../docs/external-plugins.md)
and exercises the whole contract in ~250 lines: its own storage, a rendered
screen with a form, a dashboard widget, an agent tool, an event subscription,
`.mkx` export/import and a purge hook.

## Run it against a dev core

```bash
# core
MK_EXTERNAL_DEV=1 MK_EXTERNAL_DEV_TOKEN=dev-token nx serve backend

# plugin (from this directory)
MK_CORE_URL=http://localhost:3000 MK_INSTALL_TOKEN=dev-token npm start
```

Approve it once in **Settings → External plugins**. Afterwards restarts
re-announce with the stored secret.

## Install it for real

1. In the core: **Settings → External plugins → Generate install token**.
2. Paste the token into [`compose.fragment.yml`](./compose.fragment.yml), add
   the service to your stack, start it.
3. Approve the registration on the same screen, reviewing the permissions it
   asks for (`inventory:read`).

## What to copy

- `AGENTS.md` / `CLAUDE.md` — the rules an AI agent needs to build a conforming
  plugin. Copy them into your own repo first.
- `src/main.ts` — manifest, handlers, and the SDK builders that make i18n keys
  the only way to put text on screen.
