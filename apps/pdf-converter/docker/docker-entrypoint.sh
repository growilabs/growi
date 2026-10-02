#!/bin/sh

set -e

# Set permissions for shared directory for bulk export
mkdir -p /tmp/page-bulk-export
chown -R node:node /tmp/page-bulk-export
chmod 700 /tmp/page-bulk-export

exec gosu node node dist/index.js
