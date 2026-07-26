#!/bin/bash
# Dev environment: PostgreSQL + API + Astro dev server
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

COMPOSE="docker compose -f $DIR/docker-compose.yml -f $DIR/docker-compose.dev.yml"

# The API is started directly on the host (not via compose), so it does not
# inherit the compose environment — .env has to be loaded explicitly or
# packages/api/src/lib/db.ts silently falls back to its dev default
# (daf:daf_local) and auth fails against the container's real password.
if [ -f "$DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$DIR/.env"
  set +a
else
  echo "❌ .env missing — copy .env.example and set POSTGRES_PASSWORD" >&2
  exit 1
fi

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "❌ POSTGRES_PASSWORD empty in .env (compose needs it to init the DB)" >&2
  exit 1
fi

# db is published on 127.0.0.1:5432 by docker-compose.dev.yml; keep the API's
# URL derived from the same secret compose uses so the two can't drift.
export DATABASE_URL="${DATABASE_URL:-postgresql://daf:${POSTGRES_PASSWORD}@localhost:5432/daf}"

echo "🐘 Starting PostgreSQL..."
$COMPOSE up -d db
sleep 2

# -h 127.0.0.1 forces TCP: while the entrypoint loads the baked dump it runs
# a temporary socket-only server, and a socket pg_isready would report
# healthy before the data exists (see docker-compose.yml db.healthcheck).
until $COMPOSE exec -T db pg_isready -U daf -h 127.0.0.1 > /dev/null 2>&1; do
  echo "   Waiting for DB..."
  sleep 1
done

# Runs SQL from stdin inside the db container. -h "$(hostname -i)" targets the
# container's own routable IP, which matches the appended
# `host all all all scram-sha-256` rule — the same auth path the host API
# takes. An in-container loopback connection would instead hit initdb's
# default `127.0.0.1/32 trust` and succeed with any password.
db_psql() {
  $COMPOSE exec -T db sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$(hostname -i)" -U daf -d daf -tA'
}

# pg_isready above proves the server is up, not that our password works.
if ! echo 'select 1' | db_psql > /dev/null 2>&1; then
  cat >&2 <<EOF
❌ DB rejects POSTGRES_PASSWORD from .env.

The role password lives in the container's PGDATA and is only set on first
init — an existing container keeps the password it was created with, so
changing .env afterwards makes them drift ("Skipping initialization" in
\`docker compose logs db\`).

The DB is a derived artifact (baked seed dump, no volume), so recreating it
is safe unless you have local-only changes you care about:

  $COMPOSE up -d --force-recreate db

EOF
  exit 1
fi
echo "✓ PostgreSQL ready"

# The db image is a CI-baked snapshot of data/ (Dockerfile.db), so a pulled
# `:latest` can predate a table added to src/db/seed.ts — the API then 500s
# with `relation "goteborg.<table>" does not exist` and the affected page
# breaks. Compare the tables seed.ts creates against the running DB and
# re-seed on drift. Row-level staleness is not detectable this way: after
# changing data/, re-seed explicitly with `SEED=1 ./dev.sh`.
seed_db() {
  echo "🌱 Seeding from data/ (~1 min)..."
  (cd "$DIR/packages/api" && npx tsx src/db/seed.ts) || {
    echo "❌ Seed failed — see the error above" >&2
    exit 1
  }
}

expected_tables=$(
  grep -o 'CREATE TABLE IF NOT EXISTS goteborg\.[a-z_]*' \
    "$DIR/packages/api/src/db/seed.ts" | sed 's/.*\.//' | sort -u
)
actual_tables=$(
  echo "select table_name from information_schema.tables where table_schema = 'goteborg'" |
    db_psql | tr -d '\r' | sort -u
)
missing_tables=$(comm -23 <(echo "$expected_tables") <(echo "$actual_tables"))

if [ "${SEED:-0}" = "1" ]; then
  seed_db
elif [ -n "$missing_tables" ]; then
  echo "⚠️  Baked dump is stale — missing: $(echo "$missing_tables" | tr '\n' ' ')"
  seed_db
fi

lsof -ti:3000 | xargs kill 2>/dev/null || true
lsof -ti:4321 | xargs kill 2>/dev/null || true

echo "🚀 Starting API..."
(cd "$DIR/packages/api" && npx tsx src/index.ts) &
API_PID=$!

# Bounded wait: without it a crashed API (bad DATABASE_URL, port in use)
# loops here forever instead of surfacing the error.
sleep 2
for i in $(seq 1 30); do
  curl -s localhost:3000/healthz > /dev/null 2>&1 && break
  if ! kill -0 $API_PID 2>/dev/null; then
    echo "❌ API exited during startup — see the error above" >&2
    exit 1
  fi
  echo "   Waiting for API... ($i/30)"
  sleep 1
done
if ! curl -s localhost:3000/healthz > /dev/null 2>&1; then
  echo "❌ API did not become healthy within 30s" >&2
  exit 1
fi
echo "✓ API ready at http://localhost:3000"

echo "🌐 Starting Astro dev server..."
(cd "$DIR/packages/web" && npx astro dev --port 4321) &
ASTRO_PID=$!

echo ""
echo "═══════════════════════════════════"
echo "  DeArbetarFörDig — dev running"
echo "  Web:  http://localhost:4321"
echo "  API:  http://localhost:3000"
echo "  DB:   localhost:5432"
echo "═══════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop all"

cleanup() {
  trap - EXIT INT TERM
  echo ''
  echo 'Stopping...'
  kill "$API_PID" "$ASTRO_PID" 2>/dev/null || true
  # npx wraps the real processes, so the children can outlive the wrapper and
  # keep the ports bound for the next run.
  lsof -ti:3000 | xargs kill 2>/dev/null || true
  lsof -ti:4321 | xargs kill 2>/dev/null || true
  $COMPOSE stop db
  echo 'Done.'
}
trap cleanup EXIT INT TERM
wait
