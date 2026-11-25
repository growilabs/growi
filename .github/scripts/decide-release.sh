#!/usr/bin/env bash
# Decide whether a package version still needs publishing.
#
# Usage: decide-release.sh <version> <tag-prefix>
#
# The release workflows publish a Docker image and then create the tag
# "<tag-prefix>/v<version>", so the tag's presence means the version is already on
# Docker Hub. Writes "should-release=true|false" to $GITHUB_OUTPUT.
#
# The tag is looked up on the remote (origin): actions/checkout fetches a single commit,
# so the clone has no tags of its own. ls-remote exits 0 when the tag exists and 2 when
# it does not; any other status means the lookup itself failed, which must never be read
# as "not published yet".
#
# bin/release/decide-release.spec.ts covers this script.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <version> <tag-prefix>" >&2
  exit 64
fi

VERSION=$1
TAG_PREFIX=$2
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"

# An empty version would name the tag "<tag-prefix>/v", which never exists, and the
# publish job would then push "latest" alone.
if [[ -z "$VERSION" || -z "$TAG_PREFIX" ]]; then
  echo "::error::The version and the tag prefix must not be empty."
  exit 1
fi

TAG="${TAG_PREFIX}/v${VERSION}"

# A prerelease version is a work-in-progress marker, never something to publish.
if [[ "$VERSION" == *-* ]]; then
  echo "::notice::${VERSION} is a prerelease version - nothing to publish."
  echo "should-release=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

set +e
git ls-remote --exit-code --tags origin "refs/tags/${TAG}" > /dev/null
STATUS=$?
set -e

if [[ $STATUS -eq 0 ]]; then
  echo "::notice::${TAG} already exists - nothing to publish."
  echo "should-release=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

if [[ $STATUS -ne 2 ]]; then
  echo "::error::Could not read the tags of the remote (exit ${STATUS})."
  exit 1
fi

echo "::notice::Publishing ${TAG}."
echo "should-release=true" >> "$GITHUB_OUTPUT"
