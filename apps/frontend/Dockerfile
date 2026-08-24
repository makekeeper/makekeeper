# syntax=docker/dockerfile:1

# ── Web image (SPA static + /api reverse proxy) ─────────────────────────────
# Builds the Vue SPA with Vite, then serves it from nginx. nginx also proxies
# /api to the backend container and provides the SPA history fallback. The SPA
# talks to the API via relative /api, so the build needs no env — the image is
# environment-agnostic.

# ---- dependency stage ------------------------------------------------------
# Isolating `npm ci` in its own stage is what makes the registry build cache
# (release.yml, mode=max) worth having: the layer is keyed on the lockfile, so a
# release that did not touch package-lock.json restores the whole monorepo
# install instead of re-running it.
#
# Deliberately leaner than the same stage in apps/backend/Dockerfile — the web
# image needs no Prisma engines, hence no openssl/ca-certificates. Matching the
# two byte-for-byte would buy nothing: app and web are separate matrix legs with
# separate cache refs, so neither can ever import the other's layer.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build stage -----------------------------------------------------------
FROM deps AS build

COPY . .
RUN npx nx build frontend --configuration=production

# ---- runtime stage ---------------------------------------------------------
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runtime
# Passed by release.yml for both matrix images; "dev" for local builds.
ARG APP_VERSION=dev

# ghcr links a package to its repository from this label alone (the namespace
# of the label's repo must match the package owner). Without it the package
# page stays orphaned — no README, no source link.
LABEL org.opencontainers.image.source="https://github.com/makekeeper/makekeeper" \
      org.opencontainers.image.title="MakeKeeper web" \
      org.opencontainers.image.description="MakeKeeper frontend — the SPA and its nginx front door." \
      org.opencontainers.image.version="$APP_VERSION"

# Static SPA assets.
COPY --from=build /app/dist/apps/frontend /usr/share/nginx/html
# Production server block (SPA fallback + /api proxy → app:3000).
COPY apps/frontend/nginx.prod.conf /etc/nginx/conf.d/default.conf

# The only advertised port, so a manager auto-detecting the target port from the
# image can only pick this one (#208 — see docs/tls-public-access.md §2). nginx
# additionally listens on 8080 for already-deployed stacks that route to it.
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1
