# mk-plugin-budget

Project budget — capability consumer.

Part of the reference set for [`docs/external-plugins.md`](../../docs/external-plugins.md).
This one demonstrates **consuming another third-party plugin's capability** through the core relay, with `capability:rates.convert` as a declared permission — and degrading to plain amounts when the offerer is absent.

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
