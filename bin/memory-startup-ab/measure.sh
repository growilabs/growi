#!/bin/bash
# Measure startup memory + loaded-module list of a GROWI production build.
# Usage: measure.sh <label> <appdir> <dbname> <port> <inspect-port> <outdir> <node-args...>
set -u

LABEL=$1; APPDIR=$2; DB=$3; PORT=$4; INSPECT_PORT=$5; OUTDIR=$6; shift 6

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_URI="mongodb://mongo:27017/${DB}?replicaSet=rs0"
mkdir -p "$OUTDIR"
rm -f "$OUTDIR"/modules-raw.log "$OUTDIR"/rss.csv "$OUTDIR"/server.log "$OUTDIR"/mem-*.json

echo "[$LABEL] dropping db $DB"
(cd "$APPDIR" && MURI="$MONGO_URI" node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient(process.env.MURI);
  await c.connect(); await c.db().dropDatabase();
  // v7.5 boot requires the pages collection to exist for TTL index creation
  await c.db().createCollection('pages');
  await c.close();
  console.log('dropped');
})().catch((e) => { console.error(e); process.exit(1); });
") || exit 1

echo "[$LABEL] starting server (port $PORT)"
cd "$APPDIR"
env NODE_ENV=production PORT="$PORT" MONGO_URI="$MONGO_URI" \
  ELASTICSEARCH_URI= APP_SITE_URL="http://localhost:$PORT" FILE_UPLOAD=mongodb \
  OPENTELEMETRY_ENABLED=false FORMAT_NODE_LOG=false \
  MODULE_LOG_FILE="$OUTDIR/modules-raw.log" \
  node --inspect=127.0.0.1:"$INSPECT_PORT" --import "$SCRIPT_DIR/module-log.mjs" "$@" dist/server/app.js \
  > "$OUTDIR/server.log" 2>&1 &
SRVPID=$!
echo "$SRVPID" > "$OUTDIR/server.pid"

echo boot > "$OUTDIR/phase"
(
  while kill -0 "$SRVPID" 2>/dev/null; do
    rss=$(awk '/VmRSS/{print $2}' "/proc/$SRVPID/status" 2>/dev/null) || break
    [ -n "$rss" ] && echo "$(date +%s),$(cat "$OUTDIR/phase"),$rss" >> "$OUTDIR/rss.csv"
    sleep 2
  done
) &
SAMPPID=$!

# wait for HTTP ready (up to 240 s)
code=000
for _ in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/" 2>/dev/null)
  code=${code:-000}
  if [ "$code" != "000" ] && [ "$code" != "500" ] && [ "$code" != "502" ]; then break; fi
  if ! kill -0 "$SRVPID" 2>/dev/null; then echo "[$LABEL] server died during boot"; tail -30 "$OUTDIR/server.log"; exit 1; fi
  sleep 2
done
if ! kill -0 "$SRVPID" 2>/dev/null; then echo "[$LABEL] server died during boot"; tail -30 "$OUTDIR/server.log"; exit 1; fi
echo "[$LABEL] ready (http $code)"

echo ready-idle > "$OUTDIR/phase"
sleep 30
node "$SCRIPT_DIR/cdp-mem.mjs" "$INSPECT_PORT" > "$OUTDIR/mem-ready-idle.json" 2>&1

echo "[$LABEL] running installer"
curl -s -X POST "http://localhost:$PORT/_api/v3/installer" \
  -H 'Content-Type: application/json' \
  -d '{"registerForm":{"name":"Profiling Admin","username":"profiling-admin","email":"profiling-admin@example.com","password":"ProfilingAdmin1234!","app:globalLang":"en_US"}}' \
  -o "$OUTDIR/installer-response.json" -w '%{http_code}\n'

# warm one SSR request on the top page
curl -s -o /dev/null -w "[$LABEL] GET / -> %{http_code}\n" "http://localhost:$PORT/"

echo installed-idle > "$OUTDIR/phase"
sleep 90
node "$SCRIPT_DIR/cdp-mem.mjs" "$INSPECT_PORT" > "$OUTDIR/mem-installed-idle.json" 2>&1

echo "[$LABEL] shutting down"
kill -TERM "$SRVPID" 2>/dev/null
for _ in $(seq 1 15); do kill -0 "$SRVPID" 2>/dev/null || break; sleep 1; done
kill -KILL "$SRVPID" 2>/dev/null
kill "$SAMPPID" 2>/dev/null

sort -u "$OUTDIR/modules-raw.log" > "$OUTDIR/modules.txt"
echo "[$LABEL] modules loaded: $(wc -l < "$OUTDIR/modules.txt")"
echo "[$LABEL] done"
