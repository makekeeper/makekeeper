# Licensing map

MakeKeeper is **source-available**, not "open source" in the OSI sense. This repository is
**multi-licensed**: the application is offered under the Functional Source License, while the
libraries that third-party plugin authors build on are offered under a permissive license, so the
plugin ecosystem is never touched by the FSL restriction.

## Which license applies where

| Path                                  | Role                                      | License                                                                             |
| ------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/backend`, `apps/frontend`       | The application / service                 | **FSL-1.1-ALv2** — see [`LICENSE.md`](LICENSE.md)                                   |
| `libs/plugin-*` (first-party plugins) | The product                               | **FSL-1.1-ALv2** — see [`LICENSE.md`](LICENSE.md)                                   |
| `plugins/*` (first-party external plugins) | The product (out-of-process)         | **FSL-1.1-ALv2** — see [`LICENSE.md`](LICENSE.md)                                   |
| `libs/plugin-contract`                | SDK imported by every plugin author       | **Apache-2.0** — see [`libs/plugin-contract/LICENSE`](libs/plugin-contract/LICENSE) |
| `libs/frontend-core`                  | Shared Vue primitives imported by plugins | **Apache-2.0** — see [`libs/frontend-core/LICENSE`](libs/frontend-core/LICENSE)     |
| `libs/backend-core`                   | Shared NestJS infra imported by plugins   | **Apache-2.0** — see [`libs/backend-core/LICENSE`](libs/backend-core/LICENSE)       |
| `libs/plugin-sdk`                     | SDK for out-of-process (external) plugins  | **Apache-2.0** — see [`libs/plugin-sdk/LICENSE`](libs/plugin-sdk/LICENSE)           |
| `examples/*`                          | External-plugin templates authors copy     | **Apache-2.0** — see [`examples/LICENSE`](examples/LICENSE)                         |

Guiding principle: **what others build on is permissive; what is our product is FSL.**

When a directory contains its own `LICENSE` file, that file governs the directory. Everything else
is governed by the root [`LICENSE.md`](LICENSE.md).

## What FSL-1.1-ALv2 means, in short

- **Free** for any Permitted Purpose: personal use, self-hosting (including inside a company),
  modification, forking, non-commercial education/research, and contributing back.
- **Not permitted:** a Competing Use — making MakeKeeper (or something substantially similar)
  available to others as a commercial product or service.
- **Future license:** two years after each version is released, that version additionally becomes
  available under the **Apache License, Version 2.0**.

This is a plain-language summary; the [`LICENSE.md`](LICENSE.md) text governs.

## Third-party components with copyleft terms

Distributed builds bundle third-party dependencies under their own licenses. Almost all are
permissive (MIT/Apache-2.0/BSD) and need no note here; the exception is recorded below.

| Component                                                                        | License               | How it is used                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [libvips](https://github.com/libvips/libvips), shipped as `@img/sharp-libvips-*` | **LGPL-3.0-or-later** | Server-side image resizing, via the Apache-2.0 [`sharp`](https://github.com/lovell/sharp) binding. Installed unmodified from npm as a separate, dynamically loaded native module. |

Because the library is unmodified and dynamically linked, its terms do not extend to MakeKeeper's
own source. If you redistribute a build, keep the module intact and its license notice with it.

## Commercial licensing

Need to use MakeKeeper for a purpose the FSL does not permit (e.g. offering it as a commercial or
managed service)? A separate commercial license is available — see [`CONTRIBUTING.md`](CONTRIBUTING.md)
for how contributions keep this option open, and open an issue to get in touch.

> The code boundary between the FSL and Apache-2.0 packages has been verified (issue #84): every
> first-party plugin imports only from the Apache-2.0 SDK libraries (`plugin-contract`,
> `frontend-core`, `backend-core`); those libraries never import application (`apps/*`) or plugin
> (`libs/plugin-*`) code — `plugin-contract` has no `@makekeeper/*` dependencies at all, and
> `frontend-core`/`backend-core` depend only on `plugin-contract`. No plugin-facing code is trapped
> in an FSL package, so the license boundary already matches the module boundary. The same holds
> for the external-plugin surface added in #131: `plugin-sdk` depends only on `plugin-contract`,
> and the `examples/*` plugins import only `plugin-sdk`/`plugin-contract` — never application or
> first-party-plugin code.
