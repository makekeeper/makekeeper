# syntax=docker/dockerfile:1

# ── Backend image (API only) ────────────────────────────────────────────────
# Multi-stage: an NX/webpack build produces a single bundled main.js plus a
# pruned package.json; the runtime stage installs only production deps + the
# Prisma CLI (needed so the entrypoint can run `migrate deploy` on every boot).
# Base is glibc (bookworm-slim), not alpine/musl — Prisma's schema engine used
# by `migrate` is more reliable on glibc.

# ---- dependency stage ------------------------------------------------------
# Isolating `npm ci` in its own stage is what makes the registry build cache
# (release.yml, mode=max) worth having: the layer is keyed on the lockfile, so a
# release that did not touch package-lock.json restores the whole monorepo
# install instead of re-running it. The web image has its own, leaner copy of
# this stage — the two need not match, since app and web are separate matrix
# legs with separate cache refs and cannot share a layer.
#
# openssl + ca-certificates: Prisma downloads/loads its engines during install
# and generate; without them `prisma generate`/`migrate` can fail to init.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build stage -----------------------------------------------------------
FROM deps AS build

# Full monorepo source (node_modules/dist excluded via .dockerignore).
COPY . .

# Generate the Prisma client before the TS build — the backend imports
# @prisma/client types, so the build fails without it. `generate` needs no DB.
RUN npx prisma generate --schema=apps/backend/prisma/schema.prisma

# Bundle the backend. webpack's generatePackageJson emits a self-contained
# dist/apps/backend/{main.js, package.json, package-lock.json} — an installable
# production app (the runtime stage runs `npm ci --omit=dev` against it).
RUN npx nx build backend --configuration=production

# ---- runtime stage ---------------------------------------------------------
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
WORKDIR /app
# Release version, injected by the release workflow (defaults to "dev" for local
# builds). Surfaced by AppConfigService.getAppVersion() for the update checker.
ARG APP_VERSION=dev

# ghcr links a package to its repository from this label alone (the namespace
# of the label's repo must match the package owner). Without it the package
# page stays orphaned — no README, no source link.
LABEL org.opencontainers.image.source="https://github.com/makekeeper/makekeeper" \
      org.opencontainers.image.title="MakeKeeper app" \
      org.opencontainers.image.description="MakeKeeper backend — REST API and agent runtime." \
      org.opencontainers.image.version="$APP_VERSION"

ENV NODE_ENV=production \
    PORT=3000 \
    UPLOADS_DIR=/data/uploads \
    APP_VERSION=$APP_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The pruned app (main.js + its own package.json/lock + workspace modules).
COPY --from=build /app/dist/apps/backend/ ./
# Prisma schema, migrations and config — the entrypoint runs `migrate deploy`
# against these, and `generate` needs the schema too.
COPY --from=build /app/apps/backend/prisma ./prisma
COPY --from=build /app/apps/backend/prisma.config.ts ./prisma.config.ts

# Install production deps for the bundle, add the pinned Prisma CLI (a devDep,
# not in the pruned prod deps, but required at runtime for `migrate deploy`),
# then generate the client into node_modules. --no-save keeps the CLI in
# node_modules without touching the pruned lockfile.
RUN npm ci --omit=dev \
  && npm i --no-save prisma@7.8.0 \
  && npx prisma generate --schema=./prisma/schema.prisma \
  && npm cache clean --force

COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data/uploads \
  && chown -R node:node /app /data

USER node
EXPOSE 3000

# Liveness/readiness for orchestrators. Node's global fetch (Node 18+) avoids
# needing curl/wget in the slim image. Readiness proves the DB is reachable.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "main.js"]
