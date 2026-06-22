#!/bin/bash
# Dev environment: PostgreSQL + API + Astro dev server
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🐘 Starting PostgreSQL..."
docker compose -f "$DIR/docker-compose.yml" up -d db
sleep 2

until docker compose -f "$DIR/docker-compose.yml" exec -T db pg_isready -U daf > /dev/null 2>&1; do
  echo "   Waiting for DB..."
  sleep 1
done
echo "✓ PostgreSQL ready"

lsof -ti:3000 | xargs kill 2>/dev/null || true

echo "🚀 Starting API..."
(cd "$DIR/packages/api" && npx tsx src/index.ts) &
API_PID=$!

sleep 2
until curl -s localhost:3000/healthz > /dev/null 2>&1; do
  echo "   Waiting for API..."
  sleep 1
done
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

trap "echo ''; echo 'Stopping...'; kill $API_PID $ASTRO_PID 2>/dev/null; docker compose -f '$DIR/docker-compose.yml' stop db; echo 'Done.'" EXIT INT TERM
wait
