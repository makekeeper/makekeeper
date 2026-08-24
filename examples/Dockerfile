# One image recipe for every example plugin.
#
# Build context is the REPO ROOT, because the examples import the SDK through
# the monorepo's TypeScript path aliases. A third-party plugin living in its
# own repository would simply `npm i @makekeeper/plugin-sdk` and need none of
# this — the bundling step exists only because these examples ship inside the
# core's repository.
#
#   docker build -f examples/Dockerfile --build-arg PLUGIN=mk-plugin-bambu \
#                -t mk-plugin-bambu .
#
# Stage 1 bundles the plugin and the SDK into one file, so the runtime image
# carries no node_modules and no build tooling at all.

FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
# esbuild only — the whole dependency tree is not needed to bundle a plugin.
RUN npm install --no-save esbuild@0.25.10
COPY tsconfig.base.json ./
COPY libs/plugin-contract ./libs/plugin-contract
COPY libs/plugin-sdk ./libs/plugin-sdk
ARG PLUGIN
COPY examples/${PLUGIN} ./examples/${PLUGIN}
RUN ./node_modules/.bin/esbuild examples/${PLUGIN}/src/main.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --external:node:* \
      --alias:@makekeeper/plugin-sdk=/build/libs/plugin-sdk/src/index.ts \
      --alias:@makekeeper/plugin-contract=/build/libs/plugin-contract/src/index.ts \
      --outfile=/build/plugin.mjs

FROM node:22-alpine
WORKDIR /app
COPY --from=build /build/plugin.mjs ./plugin.mjs
ENV MK_STATE_DIR=/data
VOLUME ["/data"]
# The port each example listens on is set by its compose fragment; 4400 is the
# convention for a plugin that does not care.
ENV PORT=4400
CMD ["node", "plugin.mjs"]
