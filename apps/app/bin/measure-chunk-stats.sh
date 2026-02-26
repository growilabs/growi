#!/usr/bin/env bash
# Measure ChunkModuleStats (initial / async-only / total) for [[...path]] page.
# Usage: ./bin/measure-chunk-stats.sh [port]
set -euo pipefail

PORT="${1:-3099}"
LOG=$(mktemp /tmp/chunk-stats-XXXXXX.log)

cleanup() {
  local pids
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

# 1. Ensure port is free
cleanup_pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
if [ -n "$cleanup_pids" ]; then
  kill -9 $cleanup_pids 2>/dev/null || true
  sleep 1
fi

# 2. Clean .next cache
rm -rf "$(dirname "$0")/../.next"

# 3. Start Next.js dev server
cd "$(dirname "$0")/.."
npx next dev -p "$PORT" > "$LOG" 2>&1 &
NEXT_PID=$!

# 4. Wait for server ready
echo "Waiting for Next.js to start on port $PORT ..."
for i in $(seq 1 30); do
  if grep -q "Local:" "$LOG" 2>/dev/null; then
    break
  fi
  sleep 1
done

# 5. Trigger compilation
echo "Triggering compilation ..."
curl -s -o /dev/null http://localhost:"$PORT"/

# 6. Wait for ChunkModuleStats output (non-zero initial)
echo "Waiting for compilation ..."
for i in $(seq 1 120); do
  if grep -qP 'ChunkModuleStats\] initial: [1-9]' "$LOG" 2>/dev/null; then
    break
  fi
  sleep 2
done

# 7. Print results
echo ""
echo "=== Results ==="
grep -E 'ChunkModuleStats|Compiled.*modules' "$LOG" | grep -v 'initial: 0,' | head -5
echo ""
