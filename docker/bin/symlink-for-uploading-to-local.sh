#!/bin/sh

set -e

# Corresponds to `FILE_UPLOAD=local`
mkdir -p /data/uploads
if [ ! -e "$appDir/public/uploads" ]; then
  ln -s /data/uploads $appDir/public/uploads
fi
