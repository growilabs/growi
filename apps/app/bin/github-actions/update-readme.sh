#!/bin/sh

cd docker

sed -i -e "s/^\([*] \[\`\)[^\`]\+\(\`, \`7\.4\`, .\+\]\)\(.\+\/blob\/v\).\+\(\/apps\/app\/docker\/Dockerfile.\+\)$/\1${RELEASED_VERSION}\2\3${RELEASED_VERSION}\4/" README.md
