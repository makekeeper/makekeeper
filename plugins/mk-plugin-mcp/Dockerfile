# mk-plugin-mcp — MakeKeeper MCP server plugin (#251).
#
# Build context is the REPO ROOT (the bundle imports the plugin SDK through
# the monorepo's path aliases; a third-party author would npm-install it):
#
#   docker build -f plugins/mk-plugin-mcp/Dockerfile -t mk-plugin-mcp .

FROM node:22-alpine AS build
WORKDIR /build
COPY plugins/mk-plugin-mcp/package.json plugins/mk-plugin-mcp/package-lock.json ./
RUN npm ci --no-fund && npm install --no-save esbuild@0.25.10
COPY tsconfig.base.json ./
COPY libs/plugin-contract ./libs/plugin-contract
COPY libs/plugin-sdk ./libs/plugin-sdk
COPY plugins/mk-plugin-mcp/src ./src
# The MCP SDK stays external and ships as node_modules: it is a real runtime
# dependency with its own module graph, not monorepo source to inline.
RUN ./node_modules/.bin/esbuild src/main.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --external:node:* --external:@modelcontextprotocol/* \
      --alias:@makekeeper/plugin-sdk=./libs/plugin-sdk/src/index.ts \
      --alias:@makekeeper/plugin-contract=./libs/plugin-contract/src/index.ts \
      --outfile=/build/plugin.mjs
# Drop the build-only esbuild install; what remains is the runtime graph.
RUN rm -rf node_modules && npm ci --omit=dev --no-fund

FROM node:22-alpine
WORKDIR /app
# The released version, baked in by release-plugin.yml so the running
# container reports it to the core (manifest version). Empty for local
# builds — the manifest falls back to its source version.
ARG PLUGIN_VERSION=
ENV MK_PLUGIN_VERSION=${PLUGIN_VERSION}

# ghcr links a package to its repository from this label alone (the namespace
# of the label's repo must match the package owner). Without it the package
# page stays orphaned — no README, no source link.
LABEL org.opencontainers.image.source="https://github.com/makekeeper/makekeeper" \
      org.opencontainers.image.title="mk-plugin-mcp" \
      org.opencontainers.image.description="MakeKeeper as an MCP server — exposes the instance's agent tools to MCP clients." \
      org.opencontainers.image.version="$PLUGIN_VERSION"

ENV NODE_ENV=production
ENV MK_STATE_DIR=/data
ENV PORT=4410
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/plugin.mjs ./plugin.mjs
VOLUME ["/data"]
EXPOSE 4410
CMD ["node", "plugin.mjs"]
