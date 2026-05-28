#!/usr/bin/env bash
#
# Start a single-node MongoDB replica set as a sibling container on the
# GitHub Actions job network, so a containerized job can reach it via the
# `mongodb` network alias.
#
# Why this exists:
#   - GitHub Actions `services:` cannot pass `--replSet` to the container
#     command, so it cannot start a replica set.
#   - `supercharge/mongodb-github-action` runs mongod on the host runner,
#     which is unreachable from a job that uses `container:`.
#
# Required env:
#   MONGODB_VERSION   Image tag for the official `mongo` image (e.g. "6.0", "8.0").
#
# Optional env:
#   NETWORK_ALIAS     Network alias for the mongod container (default: "mongodb").
#   REPLSET_NAME      Replica set name (default: "rs0").
#   CONTAINER_NAME    Container name (default: "mongodb").
#   READY_TIMEOUT     Seconds to wait for ping/primary (default: 60).

set -euo pipefail

: "${MONGODB_VERSION:?MONGODB_VERSION is required}"
NETWORK_ALIAS="${NETWORK_ALIAS:-mongodb}"
REPLSET_NAME="${REPLSET_NAME:-rs0}"
CONTAINER_NAME="${CONTAINER_NAME:-mongodb}"
READY_TIMEOUT="${READY_TIMEOUT:-60}"

NETWORK=$(docker network ls --filter 'name=^github_network_' --format '{{.Name}}' | head -n1)
if [ -z "$NETWORK" ]; then
  echo "GitHub Actions job network not found" >&2
  docker network ls >&2
  exit 1
fi

docker run -d --name "$CONTAINER_NAME" \
  --network "$NETWORK" \
  --network-alias "$NETWORK_ALIAS" \
  "mongo:${MONGODB_VERSION}" \
  --replSet "$REPLSET_NAME" --bind_ip_all

for _ in $(seq 1 "$READY_TIMEOUT"); do
  if docker exec "$CONTAINER_NAME" mongosh --quiet --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$CONTAINER_NAME" mongosh --quiet --eval \
  "rs.initiate({_id: \"${REPLSET_NAME}\", members: [{_id: 0, host: \"${NETWORK_ALIAS}:27017\"}]})"

for _ in $(seq 1 "$READY_TIMEOUT"); do
  state=$(docker exec "$CONTAINER_NAME" mongosh --quiet --eval 'rs.status().myState' 2>/dev/null | tr -d '[:space:]' || true)
  if [ "$state" = "1" ]; then
    break
  fi
  sleep 1
done
