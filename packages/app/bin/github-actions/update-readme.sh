#!/bin/sh

cd docker

sed -i -e "s/^\([*] \[\`\)[^\`]\+\(\`, \`4\.4\`, .\+\]\)\(.\+\/blob\/v\).\+\(\/docker\/Dockerfile.\+\)$/\1${RELEASED_VERSION}\2\3${RELEASED_VERSION}\4/" README.md
sed -i -e "s/^\([*] \[\`\)[^\`]\+\(\`, \`4\.4-nocdn\`, .\+\]\)\(.\+\/blob\/v\).\+\(\/docker\/Dockerfile.\+\)$/\1${RELEASED_VERSION}-nocdn\2\3${RELEASED_VERSION}\4/" README.md
