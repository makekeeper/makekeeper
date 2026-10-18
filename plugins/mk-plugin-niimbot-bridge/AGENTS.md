# Agent rules for plugins/mk-plugin-niimbot-bridge

First-party **external plugin**, built in the standalone third-party style
(root `CLAUDE.md` §5.11): plain Node process, no NestJS, no app i18n runtime.
Inside this directory these rules govern; `AGENTS.md` is the identical mirror
for other agents.

- **License: FSL** (root `LICENSE.md`) — this is product, not SDK. It imports
  only `@makekeeper/plugin-sdk` / `@makekeeper/plugin-contract` (Apache) plus
  its own pinned npm dependencies; never `apps/*`, `backend-core` or another
  plugin.
- `console.*` and raw `process.env` reads are allowed here (§5.11). Log lines
  are plain **English**; everything that travels through the contract to the
  core — the manifest, screen trees, toasts, error keys — carries i18n keys
  resolved from this plugin's own bundles (`src/i18n/{en,ru}.ts`, both in the
  same commit).
- Strict TS otherwise: no `any`, no naked `as`; dependencies exact-pinned and
  at least a week old (§5.6).
- **The protocol is not ours.** `@mmote/niimbluelib` owns the packets, the B1
  print task, the model table and the 10 ms packet pacing. Never hand-roll a
  frame here; if a device behaves differently, verify on paper and fix the
  call, not the library's job.
- **An acknowledgement is not a printed label.** Every device-facing change is
  verified by printing. The B1 acks sequences it then fails to print (a blank
  label, or a paper twitch and an abort) — see #359 for the byte-level facts
  and the variants that lie.
- **One job at a time.** Two overlapping jobs on one BLE link interleave their
  row packets and ruin both labels, so `PrintQueue` serialises and each caller
  awaits its own job. Keep it that way; "parallel printing" is not a feature of
  a single printhead.
- **Known dependency advisory:** `@stoprocent/noble` (under niimbluelib's
  `-node` build) pulls `patch-package` → `micromatch` → `braces`, which carries
  an open stack-exhaustion advisory with no fixed release. It is install-time
  tooling, not a runtime path, and the same advisory is already present in the
  monorepo's own tree. Re-check on each niimbluelib bump (§5.6).
- `docker build -f plugins/mk-plugin-niimbot-bridge/Dockerfile .` (repo-root
  context); dev runs via
  `./examples/run-plugin.sh plugins/mk-plugin-niimbot-bridge`.
