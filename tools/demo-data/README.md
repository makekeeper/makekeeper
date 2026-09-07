# Demo dataset — the tooling around it (dev only)

The dataset itself is **no longer here**: it ships with the product
([`apps/backend/src/app/demo/demo-dataset.ts`](../../apps/backend/src/app/demo/demo-dataset.ts))
and the backend writes it into an empty database on its first start (#339,
`DEMO_SEED=0` to opt out). One dataset, so the screenshots and what a stranger
sees on a first install can never drift apart.

What stays here is the tooling the product has no business shipping: the
photographs, and the screenshot runner.

**Not app code.** `console.*` and raw `process.env` are fine in this directory
(CLAUDE.md §5.11 applies for the same reason: no Nest, no i18n runtime).

## Filling a database

```bash
# the app's own seed — a database with no projects, items, orders, storages
# or categories in it, and DEMO_SEED unset or 1
nx serve backend
```

To re-run it on a database that has already been seeded once, clear the state
row and the rows themselves:

```bash
psql "$DATABASE_URL" -c 'delete from "DemoDataSettings"'
run tools/demo-data/undo.ts
```

## Running the photo tooling

```bash
set -a && . ./.env && set +a          # DATABASE_URL, UPLOADS_DIR

run() { NODE_PATH=$PWD/node_modules npx ts-node --transpile-only \
        --compiler-options '{"module":"commonjs","target":"es2021","esModuleInterop":true}' "$@"; }

run tools/demo-data/photos.ts         # download + ingest the photographs
run tools/demo-data/photos-trim.ts    # cap originals at 2048 px (~15 MB for the set)

run tools/demo-data/undo-photos.ts    # remove them again
run tools/demo-data/undo.ts           # remove every `demo_` row
```

`NODE_PATH` is needed because these files sit outside the NX projects and would
otherwise not resolve `@prisma/client`.

## Photographs

`photos.ts` downloads from Wikimedia Commons and ingests each file **the way an upload would**: the
canonical `YYYY/MM/DD/<id>.<ext>` layout, the eager `xs`/`sm` renditions generated from the repo's
own preview profile (`libs/backend-core/src/lib/image-derivatives.ts`, #113), a real `Attachment`
row, and the cover pinned on the item or project. That is deliberate — a demo dataset that
side-stepped the derivative pipeline would hide bugs in it.

The Commons **search API rate-limits hard** (429 after a handful of calls, ~10 s apart is tolerated),
so file URLs are derived arithmetically from `md5(File_Name)` instead of being looked up.
`search-commons.sh` is the helper for _finding_ candidates when the picture list changes.

`photo-manifest.tsv` maps each item to its source file and Commons page. The pictures are CC0 /
CC BY / CC BY-SA / public domain — fine for a local dev instance, but **they need attribution before
anything ships them**, which is one reason the real feature should carry its own assets.

## Screenshots

`screenshots.js` walks the sections in both themes at 2×, authenticating by planting the session in
`localStorage`. See the header comment for the environment it takes. Whose token you pass decides
what lands in the picture — for anything public, use an account that holds only the demo dataset.

```bash
DEMO_TOKEN=… DEMO_SESSION_KEY=… CHROMIUM=/path/to/chromium \
  node tools/demo-data/screenshots.js ./shots
```

`DEMO_SESSION_KEY` matters when a shot must show something that depends on a decrypted secret (#63):
without it the assistant panel photographs as disconnected.

Note that the **Statistics** section reads `StatsDaily`, which `StatsAggregationJob` rebuilds on
application boot — data seeded into a running instance shows up there only after the backend
restarts.
