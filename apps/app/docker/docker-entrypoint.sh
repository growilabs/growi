#!/bin/sh

set -e

# Support `FILE_UPLOAD=local`
mkdir -p /data/uploads
if [ ! -e "./public/uploads" ]; then
  ln -s /data/uploads ./public/uploads
fi
chown -R node:node /data/uploads
chown -h node:node ./public/uploads

# Set permissions for shared directory for bulk export
mkdir -p /tmp/page-bulk-export
chown -R node:node /tmp/page-bulk-export
chmod 700 /tmp/page-bulk-export

exec gosu node /bin/bash -c "$@"
