#!/usr/bin/env bash
#
# Starts a single-node MongoDB replica set (rs0) on localhost:27017 for CI.
#
# Usage: start-mongodb-replica-set.sh <mongodb-version>
#
# The data directory is a tmpfs, so MongoDB never waits on the runner's disk.
# The disk's speed differs from runner to runner, and a slow one slows every
# write-heavy integration test at once (growilabs/growi#12193). The data is
# thrown away with the runner anyway.
set -euo pipefail

MONGODB_VERSION="${1:?usage: start-mongodb-replica-set.sh <mongodb-version>}"
CONTAINER_NAME=mongodb

run_mongosh() {
  docker exec "$CONTAINER_NAME" mongosh --quiet --eval "$1"
}

# Retries a mongosh check once a second; fails after the given number of tries.
wait_until() {
  local description="$1" tries="$2" script="$3"
  for _ in $(seq 1 "$tries"); do
    if run_mongosh "$script" 2>/dev/null | grep -q true; then
      return 0
    fi
    sleep 1
  done
  echo "MongoDB: ${description} did not happen within ${tries} seconds" >&2
  docker logs --tail 50 "$CONTAINER_NAME" >&2 || true
  return 1
}

docker run --name "$CONTAINER_NAME" --detach \
  --publish 27017:27017 \
  --tmpfs /data/db \
  -e GLIBC_TUNABLES=glibc.pthread.rseq=1 \
  "mongo:${MONGODB_VERSION}" \
  mongod --port 27017 --replSet rs0

wait_until 'accepting connections' 30 'db.adminCommand("ping").ok === 1'

run_mongosh 'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })'

wait_until 'becoming primary' 60 'db.hello().isWritablePrimary'
