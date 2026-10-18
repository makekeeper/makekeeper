# mk-plugin-niimbot-bridge — MakeKeeper BLE print bridge (#362).
#
# Build context is the REPO ROOT (the bundle imports the plugin SDK through the
# monorepo's path aliases; a third-party author would npm-install it):
#
#   docker build -f plugins/mk-plugin-niimbot-bridge/Dockerfile -t mk-plugin-niimbot-bridge .
#
# The image needs a Bluetooth adapter at RUNTIME, which is why it is meant for
# the box next to the printer and not for the app host — see compose.fragment.yml.

FROM node:22-bookworm-slim AS build
WORKDIR /build
# noble and serialport are native addons: the toolchain and libudev headers are
# build-time only and do not travel into the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ libudev-dev \
 && rm -rf /var/lib/apt/lists/*
COPY plugins/mk-plugin-niimbot-bridge/package.json plugins/mk-plugin-niimbot-bridge/package-lock.json ./
RUN npm ci --no-fund && npm install --no-save esbuild@0.25.10
COPY tsconfig.base.json ./
COPY libs/plugin-contract ./libs/plugin-contract
COPY libs/plugin-sdk ./libs/plugin-sdk
COPY plugins/mk-plugin-niimbot-bridge/src ./src
# niimbluelib stays external and ships as node_modules: it is a real runtime
# dependency with native addons under it, not monorepo source to inline.
RUN ./node_modules/.bin/esbuild src/main.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --external:node:* --external:@mmote/* \
      --alias:@makekeeper/plugin-sdk=./libs/plugin-sdk/src/index.ts \
      --alias:@makekeeper/plugin-contract=./libs/plugin-contract/src/index.ts \
      --outfile=/build/plugin.mjs
# Drop the build-only esbuild install; what remains is the runtime graph.
RUN rm -rf node_modules && npm ci --omit=dev --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
# The released version, baked in by release-plugin.yml so the running container
# reports it to the core. Empty for local builds — the manifest falls back to
# its source version.
ARG PLUGIN_VERSION=
ENV MK_PLUGIN_VERSION=${PLUGIN_VERSION}

LABEL org.opencontainers.image.source="https://github.com/makekeeper/makekeeper" \
      org.opencontainers.image.title="mk-plugin-niimbot-bridge" \
      org.opencontainers.image.description="MakeKeeper BLE print bridge — owns a Niimbot label printer and prints for any device." \
      org.opencontainers.image.version="$PLUGIN_VERSION"

# The BlueZ runtime (not the headers): noble talks to the adapter through it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bluez dbus \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV MK_STATE_DIR=/data
ENV PORT=4420
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/plugin.mjs ./plugin.mjs
VOLUME ["/data"]
EXPOSE 4420
CMD ["node", "plugin.mjs"]
