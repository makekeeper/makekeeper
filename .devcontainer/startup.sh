#!/usr/bin/env bash
# .devcontainer/startup.sh
# Runs automatically on every devcontainer start via postStartCommand.
# Starts PostgreSQL via docker-compose (port-published, so reachable at localhost:5432),
# runs Prisma migrations and seed, then launches NestJS + Vite dev servers.

set -euo pipefail

# Derived, not hardcoded: the workspace folder is whatever the repo was cloned
# into, and a wrong literal here fails at the very first command.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(dirname "$HERE")"
LOG_DIR="$WORKSPACE/.devcontainer/logs"
mkdir -p "$LOG_DIR"

echo "════════════════════════════════════════"
echo "  MakeKeeper — startup sequence"
echo "════════════════════════════════════════"

# ─── 1. Services via docker-compose (PostgreSQL & Nginx) ──────────────────────
echo "→ [1/4] Starting PostgreSQL & Nginx..."
docker compose -f "$HERE/docker-compose.yml" up -d --remove-orphans

echo "   Waiting for postgres to be healthy..."
RETRIES=30
until docker inspect makekeeper-db --format '{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "   ✗ Timed out waiting for postgres. Check: docker logs makekeeper-db"
    exit 1
  fi
  sleep 2
done
echo "   ✓ PostgreSQL healthy at localhost:5432"

echo "   Waiting for nginx to be active..."
RETRIES=15
until [ "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080)" -ne 000 ]; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "   ✗ Timed out waiting for nginx. Check: docker logs makekeeper-nginx"
    exit 1
  fi
  sleep 1
done
echo "   ✓ Nginx active at localhost:8080"

# ─── 2. Install npm deps (if needed) ──────────────────────────────────────────
echo "→ [2/4] Installing npm dependencies..."
cd "$WORKSPACE"
npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -5
echo "   ✓ npm deps ready"

# ─── 3. Prisma: push schema + seed ────────────────────────────────────────────
PRISMA_DIR="$WORKSPACE/apps/backend"
SEED_SCRIPT="$WORKSPACE/apps/backend/prisma/seed.ts"

# Load DATABASE_URL from .env (prisma.config.ts reads this; localhost:5432 is the port
# postgres publishes — the daemon runs inside this devcontainer, so it binds here)
if [ -f "$WORKSPACE/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$WORKSPACE/.env"
  set +a
fi

echo "→ [3/4] Running Prisma migrations..."
cd "$PRISMA_DIR"
# migrate deploy applies existing migration files; falls back to db push for fresh containers
npx prisma migrate deploy 2>&1 \
  || npx prisma db push --accept-data-loss 2>&1
echo "   ✓ Schema up to date"

echo "   Running database seed (if needed)..."
# Check if the Component table is empty via psql (idempotent — only seeds once)
COMPONENT_COUNT=$(docker exec makekeeper-db \
  psql -U postgres -d diy_inspector -t -c 'SELECT COUNT(*) FROM "Component";' 2>/dev/null \
  | tr -d ' \n' || echo "0")

if [ "${COMPONENT_COUNT:-0}" = "0" ]; then
  npx ts-node --compiler-options '{"module":"commonjs"}' "$SEED_SCRIPT" 2>&1 | tail -10
  echo "   ✓ Seed data loaded"
else
  echo "   ✓ Database already seeded (${COMPONENT_COUNT} components), skipping"
fi

cd "$WORKSPACE"

# ─── 4. Start dev servers ─────────────────────────────────────────────────────
echo "→ [4/4] Starting dev servers..."

# Kill any leftover processes on ports 3000 or 4200
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 4200/tcp 2>/dev/null || true

nohup npx nx run-many --targets=serve \
  > "$LOG_DIR/nx-serve.log" 2>&1 &
NX_PID=$!
echo "   ✓ nx serve started (PID $NX_PID) → logs at .devcontainer/logs/nx-serve.log"

# Wait for backend to respond
echo "   Waiting for backend API..."
RETRIES=40
until curl -sf http://localhost:3000/api > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "   ✗ Backend didn't start in time. Check .devcontainer/logs/nx-serve.log"
    exit 1
  fi
  sleep 2
done
echo "   ✓ Backend running on :3000"

# Wait for frontend to respond
RETRIES=20
until curl -sf http://localhost:4200 > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "   ✗ Frontend didn't start in time. Check .devcontainer/logs/nx-serve.log"
    exit 1
  fi
  sleep 2
done
echo "   ✓ Frontend running on :4200"

echo ""
echo "════════════════════════════════════════"
echo "  ✓ All services up!"
echo "  Open: http://localhost:8080"
echo "════════════════════════════════════════"
