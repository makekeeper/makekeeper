#!/usr/bin/env bash
#
# Start an example plugin container and tell the admin its pairing code.
#
#   ./examples/run-plugin.sh examples/mk-plugin-bambu
#   ./examples/run-plugin.sh examples/mk-plugin-climate --core http://localhost:3000
#   ./examples/run-plugin.sh examples/mk-plugin-bambu -- -e HA_URL=http://ha:8123
#
# Why a launcher exists at all: `docker run -d` prints a container id, not the
# pairing code, and the code only appears later inside the container's log.
# Every shortcut around that — piping logs, grepping in a loop — hides startup
# failures, which is exactly when you need to see them. So this script picks
# the code ITSELF, hands it to the container, and prints it only after
# confirming the container is actually running. If anything fails, you get the
# error and the container's log, and no code at all.
#
# It is not part of the plugin contract: any plugin can be started by hand.
# It exists because the manual way has a sharp edge.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: run-plugin.sh <plugin-dir> [options] [-- <extra docker args>]

  <plugin-dir>          e.g. examples/mk-plugin-bambu

options:
  --core <url>          core URL as seen FROM the container (default:
                        http://app:3000 when the core is a container on the
                        same network, else http://host.docker.internal:3000)
  --network <net>       docker network to join (default: makekeeper_default —
                        joined when it exists, created when it does not).
                        Being on it is what lets the core and the web proxy
                        reach the plugin by container name (#250).
  --port <port>         port the plugin listens on (default: the one this
                        plugin already uses, or a free one)
  --name <name>         container name (default: the plugin directory name)
  --state <path>        bind-mount a HOST directory for the plugin's data
                        instead of the managed volume (rarely what you want)
  --no-build            reuse the existing image instead of rebuilding
  -h, --help            this text
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage
PLUGIN_DIR="${1%/}"
shift

# Empty ⇒ decided below once the network is known.
CORE_URL=""
# Empty ⇒ decided below: the port this plugin is already running on, or a free
# one. Passing --port still wins.
PORT=""
NAME=""
STATE_DIR=""
NETWORK="auto"
BUILD=1
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core) CORE_URL="$2"; shift 2 ;;
    --network) NETWORK="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --state) STATE_DIR="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    -h|--help) usage ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[[ -d "$PLUGIN_DIR/src" ]] || { echo "not a plugin directory: $PLUGIN_DIR" >&2; exit 2; }

PLUGIN="$(basename "$PLUGIN_DIR")"
NAME="${NAME:-$PLUGIN}"
# A named docker volume, not a host folder: the plugin's data is the container's
# business, /tmp is swept on reboot on most systems, and a bind-mounted
# directory brings host uid/gid into it for no benefit. `--state` still takes a
# path when someone genuinely wants to read the files.
VOLUME="${NAME}-data"
if [[ -n "$STATE_DIR" ]]; then
  mkdir -p "$STATE_DIR"
  MOUNT="$STATE_DIR"
else
  MOUNT="$VOLUME"
fi
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Where the container lives (#250, #256). Always a bridge network — created
# here when neither the packaged stack nor the devcontainer stack has made it.
# There is deliberately no fallback to the host namespace: `--network=host`
# puts a third-party image beside everything else, including the backend's
# node inspector on loopback, which is arbitrary code execution against the
# machine the source lives on. `--network=host` is still accepted when asked
# for explicitly; it is just never chosen for you.
if [[ "$NETWORK" == "auto" ]]; then
  NETWORK="makekeeper_default"
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then
    echo "network: $NETWORK (auto-detected; --network overrides)" >&2
  else
    docker network create "$NETWORK" >/dev/null
    echo "network: $NETWORK (created; --network overrides)" >&2
  fi
fi

# Is the CORE itself a container on this network? In the packaged stack it is
# (`app`), and container-name routing works in both directions. In this repo's
# dev stack it is `nx serve` in the devcontainer, outside every network: it is
# reached at the docker gateway and calls back to a published port. The two
# cases need different URLs on both ends, and only this tells them apart.
#
# It asks for the ALIAS, not the container name: compose names the core
# container <project>-app-1, and `app` — the name MK_CORE_URL resolves — is
# the network alias it gets from its service name. Matching on the container
# name would miss every real deploy stack.
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

# The topology, named once. Everything downstream switches on THIS rather than
# re-testing the network's name — the name is an argument, the mode is what the
# rest of the script actually reasons about:
#   host    — the caller asked for the host namespace explicitly (never chosen
#             for you); core and plugin meet on loopback.
#   shared  — the core is a container on this network; both directions route by
#             container name.
#   gateway — the core is outside every docker network (the dev stack's
#             `nx serve`); it is reached at the docker gateway and calls back
#             to a port the plugin publishes.
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

# The port a container was started with, read back from its environment. This
# is what makes re-running an existing plugin keep its address: the core stored
# that baseUrl at pairing, and a plugin that comes back on a different port is
# a plugin the core cannot reach.
# `|| true` is load-bearing: under `set -e` with `pipefail`, docker inspect
# failing on a container that does not exist yet would kill the script inside
# the command substitution that calls this — silently, before a single line of
# output. Not existing is the NORMAL case here.
port_of_container() {
  # `docker container inspect`, not `docker inspect`: the latter also resolves
  # IMAGES by name, and the image carries the Dockerfile's own `ENV PORT`. That
  # made a removed plugin "reuse" the image's default port and collide with
  # whatever already had it.
  docker container inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null \
    | sed -n 's/^PORT=//p' | head -1 || true
}

# Every port already spoken for by a container of ours, running or stopped —
# a stopped one still owns its address as far as the core is concerned.
taken_ports() {
  local names name
  names="$(docker ps -aq 2>/dev/null || true)"
  for name in $names; do
    port_of_container "$name"
  done
}

port_is_free() {
  local port="$1"
  # Something already listening locally?
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && { exec 3>&-; return 1; }
  # Claimed by another container of ours, even a stopped one?
  if taken_ports | grep -qx "$port"; then return 1; fi
  return 0
}

pick_free_port() {
  local port
  # A band nothing standard lives in; 200 tries is far more than a workshop
  # will ever need and still terminates.
  for _ in $(seq 200); do
    port=$(( 4400 + RANDOM % 600 ))
    if port_is_free "$port"; then
      echo "$port"
      return 0
    fi
  done
  echo "could not find a free port in 4400-4999" >&2
  return 1
}

if [[ -z "$PORT" ]]; then
  # An existing container keeps its port; a new one gets a free one, so
  # starting a second, third and fourth plugin needs no bookkeeping from
  # whoever is starting them.
  PORT="$(port_of_container "$NAME" || true)"
  if [[ -n "$PORT" ]]; then
    echo "reusing port $PORT (the one ${NAME} already runs on)" >&2
  else
    PORT="$(pick_free_port)" || exit 1
    echo "picked free port $PORT" >&2
  fi
fi

if [[ "$BUILD" == 1 ]]; then
  echo "building $PLUGIN…" >&2
  # Build context is the repo root: the examples import the SDK through the
  # monorepo's path aliases (a third-party plugin would just npm i the SDK).
  # A plugin shipping its own Dockerfile (real npm dependencies —
  # plugins/mk-plugin-mcp) builds with that instead of the shared recipe.
  DOCKERFILE="$REPO_ROOT/examples/Dockerfile"
  [[ -f "$PLUGIN_DIR/Dockerfile" ]] && DOCKERFILE="$PLUGIN_DIR/Dockerfile"
  docker build -f "$DOCKERFILE" \
    --build-arg "PLUGIN=$PLUGIN" -t "$PLUGIN" "$REPO_ROOT" >&2
fi

# The code is chosen HERE, before the container exists, which is the whole
# point: it can be shown to the admin directly instead of being fished out of
# a log. The core only ever sees its hash, so a code on this screen is no more
# sensitive than one in `docker logs`.
PIN="$(( RANDOM % 9000 + 1000 ))"

docker rm -f "$NAME" >/dev/null 2>&1 || true

# The plugin's data used to live in /tmp/<name>. Moving it into a volume must
# not orphan a container that is already PAIRED: its registration secret is in
# there, and without it the core keeps an installation nothing can answer for
# while the container announces itself as a stranger. So the first run with an
# empty volume adopts whatever the old directory holds, once.
LEGACY="/tmp/$NAME"
if [[ -z "$STATE_DIR" && -d "$LEGACY" ]]; then
  if ! docker run --rm -v "$VOLUME:/data" --entrypoint sh "$PLUGIN" \
      -c '[ -z "$(ls -A /data 2>/dev/null)" ]' >/dev/null 2>&1; then
    : # the volume already has state — leave it alone
  else
    echo "adopting existing state from ${LEGACY} into volume ${VOLUME}" >&2
    docker run --rm -v "$VOLUME:/data" -v "$LEGACY:/legacy:ro" \
      --entrypoint sh "$PLUGIN" -c 'cp -a /legacy/. /data/ 2>/dev/null || true' \
      >/dev/null 2>&1 || true
  fi
fi

# The base URL is what the core stores and calls back on, so it must be the
# one that works from where the CORE stands. A core on this network reaches
# the container by name; a core outside it (the dev stack) reaches it only
# through a published port — which is why that case publishes one, and why it
# also needs the gateway alias to call the core in the other direction.
PUBLISH=()
GATEWAY=()
case "$NET_MODE" in
  host) PLUGIN_URL="http://localhost:$PORT" ;;
  shared) PLUGIN_URL="http://$NAME:$PORT" ;;
  gateway)
    PLUGIN_URL="http://localhost:$PORT"
    # 127.0.0.1, not a bare `-p PORT:PORT`: the core is the only thing that
    # needs to reach this, and a bare publish would put a third-party plugin on
    # every interface the machine has. Add another `-p` after `--` if something
    # else genuinely has to talk to it.
    PUBLISH=(-p "127.0.0.1:$PORT:$PORT")
    GATEWAY=(--add-host "host.docker.internal:host-gateway")
    ;;
esac

# Errors here are NOT swallowed: if the run fails, its message is the output.
docker run -d --name "$NAME" --network "$NETWORK" \
  "${PUBLISH[@]}" \
  "${GATEWAY[@]}" \
  -e "MK_CORE_URL=$CORE_URL" \
  -e "MK_PLUGIN_URL=$PLUGIN_URL" \
  -e "PORT=$PORT" \
  -e "MK_PAIRING_CODE=$PIN" \
  -v "$MOUNT:/data" \
  "${EXTRA[@]}" \
  "$PLUGIN" >/dev/null

# A container can start and die a second later — an unreachable core, a bad
# manifest, a port already taken. Give it a moment, then check, and show the
# log instead of a code if it is gone.
sleep 2
if [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]]; then
  echo >&2
  echo "container '$NAME' is not running — no pairing code. Its log:" >&2
  echo >&2
  docker logs "$NAME" 2>&1 | tail -30 >&2
  exit 1
fi

# Show whatever the plugin already said (a failing core, a stale secret) so a
# working container that cannot yet reach the core is not mistaken for a
# healthy one.
STARTUP_LOG="$(docker logs "$NAME" 2>&1 \
  | grep -vE 'PAIRING CODE|={10,}|Enter it in Settings' \
  | sed '/^$/d' | tail -5 || true)"
if [[ -n "$STARTUP_LOG" ]]; then
  echo >&2
  echo "$STARTUP_LOG" >&2
fi

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
