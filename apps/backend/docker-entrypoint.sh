#!/usr/bin/env bash
# Backend container entrypoint — the single mechanism for both install and
# upgrade: it applies pending DB migrations on EVERY start, then execs the app.
# An image update carries its migrations with it, so `pull && up -d` migrates
# automatically with no manual step.
set -euo pipefail

log() { echo "[entrypoint] $*"; }

# ── 1. Apply migrations ─────────────────────────────────────────────────────
# `migrate deploy` is idempotent (only pending migrations) and takes an advisory
# lock. We retry a few times so a DB that is still accepting connections (compose
# gates on `service_healthy`, but be defensive) doesn't fail the boot spuriously.
# A migration that genuinely fails must abort the boot — we must NOT start the
# app against a half-migrated schema (set -e + explicit exit).
MIGRATE_RETRIES="${MIGRATE_RETRIES:-10}"
attempt=1
until npx prisma migrate deploy --schema=./prisma/schema.prisma; do
  status=$?
  if [ "$attempt" -ge "$MIGRATE_RETRIES" ]; then
    log "prisma migrate deploy failed after ${attempt} attempts (exit ${status}); aborting boot."
    exit "$status"
  fi
  log "migrate deploy failed (attempt ${attempt}/${MIGRATE_RETRIES}); DB may still be starting — retrying in 3s…"
  attempt=$((attempt + 1))
  sleep 3
done
log "migrations up to date."

# ── 2. Start the app ────────────────────────────────────────────────────────
log "starting application…"
exec "$@"
