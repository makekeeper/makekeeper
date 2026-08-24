#!/usr/bin/env bash
# MakeKeeper — update helper. Thin alias for `install.sh --update`, kept so
# the docker-compose detection and readiness-wait logic live in exactly ONE
# place (install.sh). Pulls the newest images and restarts the stack against
# your already-deployed compose file and .env (both preserved); DB migrations
# apply automatically on the app container's boot.
#
# Tip: pin TAG=<version> in .env for reproducible updates instead of `latest`.
# Back up first — see ../INSTALL.md (Backup & restore).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run install.sh's --update path against the current stack directory (defaults
# to CWD), reusing the compose file already deployed here (no re-download).
exec env MK_DIR="${MK_DIR:-.}" MK_SKIP_COMPOSE_FETCH=1 \
  "${SCRIPT_DIR}/install.sh" --update
