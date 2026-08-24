#!/usr/bin/env bash
#
# Install a first-party MakeKeeper plugin from its PUBLISHED image and tell
# the admin its pairing code.
#
#   ./plugins/install.sh mcp
#   ./plugins/install.sh mcp --token mki_… --tag 0.5.0
#   ./plugins/install.sh mcp -- -e SOME_VAR=value
#
# The from-image counterpart of examples/run-plugin.sh (which builds from
# source): no repo checkout is really needed beyond this script — it pulls
# ghcr.io/makekeeper/mk-plugin-<id>, puts the container on the app's compose
# network, hands it a pairing code it prints for you, and keeps the
# plugin's state in a named docker volume. See ./INSTALL.md for the other
# installation paths (deploy-stack services, compose fragments, docker run).

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: install.sh <plugin-id> [options] [-- <extra docker args>]

  <plugin-id>           e.g. mcp (or mk-plugin-mcp — both work)

options:
  --tag <tag>           image tag (default: latest; pin a version in production)
  --image <ref>         full image reference (overrides the ghcr default)
  --token <mki_…>       one-time install token for a headless install
                        (Settings → External plugins → "Generate install token")
  --core <url>          core URL as seen FROM the container (default:
                        http://app:3000 when the core is a container on the
                        same network, else http://host.docker.internal:3000)
  --network <net>       docker network to join (default: makekeeper_default —
                        joined when it exists, created when it does not)
  --name <name>         container name = the plugin's hostname on the network
                        (default: the plugin id)
  --port <port>         port the plugin listens on (default: the image's own)
  -h, --help            this text
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage
PLUGIN_ID="${1#mk-plugin-}"
shift

IMAGE=""
TAG="latest"
TOKEN=""
CORE_URL=""
NETWORK="auto"
NAME=""
PORT=""
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --core) CORE_URL="$2"; shift 2 ;;
    --network) NETWORK="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) usage ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

IMAGE="${IMAGE:-ghcr.io/makekeeper/mk-plugin-${PLUGIN_ID}}"
NAME="${NAME:-$PLUGIN_ID}"
VOLUME="${NAME}-data"

# Same network logic as examples/run-plugin.sh (#250, #256): always a bridge
# network, created here when nothing else has made it. There is deliberately
# no fallback to the host namespace — that put a third-party image beside the
# core process and everything else on the box. `--network=host` is still
# honoured when asked for explicitly; it is never chosen for you.
#
# Kept as a copy of run-plugin.sh's block ON PURPOSE, not extracted to a
# sourced helper: this script's whole premise (see the header) is that it is
# the only file you need — it is fetched and run on machines with no checkout,
# so it can have no siblings. Change one of the two and change the other.
if [[ "$NETWORK" == "auto" ]]; then
  NETWORK="makekeeper_default"
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then
    echo "network: $NETWORK (auto-detected; --network overrides)" >&2
  else
    docker network create "$NETWORK" >/dev/null
    echo "network: $NETWORK (created; --network overrides)" >&2
  fi
fi

# Is the CORE a container on this network? In the packaged stack it is
# (`app`) and container-name routing works both ways; in the repo's dev stack
# it is `nx serve` in the devcontainer, reached at the docker gateway and
# calling back to a published port.
#
# It asks for the ALIAS, not the container name: compose names the core
# container <project>-app-1, and `app` — the name MK_CORE_URL resolves — is
# the network alias it gets from its service name.
core_on_network() {
  local net="$1" id name
  for id in $(docker network inspect "$net" \
                -f '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' 2>/dev/null); do
    name="$(docker inspect "$id" -f '{{.Name}}' 2>/dev/null || true)"
    [[ "${name#/}" == "app" ]] && return 0
    docker inspect "$id" -f \
      '{{range $n, $cfg := .NetworkSettings.Networks}}{{range $cfg.Aliases}}{{println .}}{{end}}{{end}}' \
      2>/dev/null | grep -qx app && return 0
  done
  return 1
}

# The topology, named once; everything downstream switches on THIS rather than
# re-testing the network's name. `host` = the caller asked for the host
# namespace explicitly; `shared` = the core is a container on this network;
# `gateway` = the core is outside every docker network (the dev stack), reached
# at the docker gateway and calling back to a published port.
if [[ "$NETWORK" == "host" ]]; then
  NET_MODE="host"
elif core_on_network "$NETWORK"; then
  NET_MODE="shared"
else
  NET_MODE="gateway"
fi

if [[ -z "$CORE_URL" ]]; then
  case "$NET_MODE" in
    host) CORE_URL="http://localhost:3000" ;;
    shared) CORE_URL="http://app:3000" ;;
    gateway) CORE_URL="http://host.docker.internal:3000" ;;
  esac
fi

echo "pulling ${IMAGE}:${TAG}…" >&2
if ! docker pull "${IMAGE}:${TAG}" >/dev/null 2>&1; then
  # A locally built image (e.g. via examples/run-plugin.sh or docker build)
  # is a valid source too — only fail when the reference exists nowhere.
  if ! docker image inspect "${IMAGE}:${TAG}" >/dev/null 2>&1; then
    echo "cannot pull ${IMAGE}:${TAG} and no local image with that name exists" >&2
    exit 1
  fi
  echo "pull failed; using the local image" >&2
fi

# The image knows which port its plugin listens on (ENV PORT); read it back
# instead of maintaining a per-plugin table here. --port still wins (needed
# when the port is published and the default one is already taken).
if [[ -z "$PORT" ]]; then
  PORT="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' \
    "${IMAGE}:${TAG}" | sed -n 's/^PORT=//p' | head -1)"
  [[ -n "$PORT" ]] || { echo "image declares no PORT; pass --port" >&2; exit 1; }
fi

# A core on this network reaches the container by name; a core outside it
# reaches it only through a published port — so publish one, and hand the
# container the gateway alias it needs to call back the other way.
PUBLISH=()
GATEWAY=()
case "$NET_MODE" in
  host) PLUGIN_URL="http://localhost:$PORT" ;;
  shared) PLUGIN_URL="http://$NAME:$PORT" ;;
  gateway)
    PLUGIN_URL="http://localhost:$PORT"
    # 127.0.0.1, not a bare `-p PORT:PORT`: only the core needs to reach this,
    # and a bare publish would put a third-party plugin on every interface the
    # machine has. Add another `-p` after `--` if something else must talk to it.
    PUBLISH=(-p "127.0.0.1:$PORT:$PORT")
    GATEWAY=(--add-host "host.docker.internal:host-gateway")
    ;;
esac

# The pairing code is chosen HERE so it can be shown directly instead of being
# fished out of a log; the core only ever sees its hash. Irrelevant (but
# harmless) when an install token skips pairing entirely.
PIN="$(( RANDOM % 9000 + 1000 ))"

TOKEN_ENV=()
[[ -n "$TOKEN" ]] && TOKEN_ENV=(-e "MK_INSTALL_TOKEN=$TOKEN")

docker rm -f "$NAME" >/dev/null 2>&1 || true

# Errors here are NOT swallowed: if the run fails, its message is the output.
docker run -d --name "$NAME" --network "$NETWORK" \
  "${PUBLISH[@]}" \
  "${GATEWAY[@]}" \
  --restart unless-stopped \
  -e "MK_CORE_URL=$CORE_URL" \
  -e "MK_PLUGIN_URL=$PLUGIN_URL" \
  -e "PORT=$PORT" \
  -e "MK_PAIRING_CODE=$PIN" \
  "${TOKEN_ENV[@]}" \
  -v "$VOLUME:/data" \
  "${EXTRA[@]}" \
  "${IMAGE}:${TAG}" >/dev/null

# A container can start and die a second later — an unreachable core, a bad
# token. Give it a moment, then check, and show the log instead of a code if
# it is gone.
sleep 2
if [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]]; then
  echo >&2
  echo "container '$NAME' is not running — no pairing code. Its log:" >&2
  echo >&2
  docker logs "$NAME" 2>&1 | tail -30 >&2
  exit 1
fi

STARTUP_LOG="$(docker logs "$NAME" 2>&1 \
  | grep -vE 'PAIRING CODE|={10,}|Enter it in Settings' \
  | sed '/^$/d' | tail -5 || true)"
if [[ -n "$STARTUP_LOG" ]]; then
  echo >&2
  echo "$STARTUP_LOG" >&2
fi

if [[ -n "$TOKEN" ]]; then
  cat <<EOF

  ${NAME} is running (headless install via the provided token).

  Review and approve it in Settings → External plugins.

  logs:   docker logs -f ${NAME}
  stop:   docker rm -f ${NAME}
  forget: docker rm -f ${NAME} && docker volume rm ${VOLUME}

EOF
else
  cat <<EOF

  ${NAME} is running.

  PAIRING CODE:  ${PIN}

  Open Settings → External plugins → "Connect a plugin", then type the code
  on the card that appears. The container keeps announcing itself until you
  do, so the order does not matter and no restart is needed.

  logs:   docker logs -f ${NAME}
  stop:   docker rm -f ${NAME}
  forget: docker rm -f ${NAME} && docker volume rm ${VOLUME}
          (that discards the plugin's data AND its pairing — it will come back
           as a new candidate needing a fresh code)

EOF
fi
