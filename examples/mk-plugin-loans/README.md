# mk-plugin-loans

Lent out — per-scope reference plugin.

Part of the reference set for [`docs/external-plugins.md`](../../docs/external-plugins.md).
This one demonstrates **per-scope scope model**: the core hands it an opaque `scopeId` on every call and one background token per scope; the plugin keys its own storage by it. The core's scope policy stops at the core — it cannot reach into a third-party database, which is exactly what the declaration exists to make explicit.

## Run it against a dev core

```bash
# core
MK_EXTERNAL_DEV=1 MK_EXTERNAL_DEV_TOKEN=dev-token nx serve backend

# plugin (from this directory)
MK_CORE_URL=http://localhost:3000 MK_INSTALL_TOKEN=dev-token npm start
```

Approve it once in **Settings → External plugins**; afterwards restarts
re-announce with the stored secret.

## Install it for real

Generate an install token in the core, paste it into
[`compose.fragment.yml`](./compose.fragment.yml), add the service to your
stack, start it, then approve the registration — reviewing the permissions it
asks for.
