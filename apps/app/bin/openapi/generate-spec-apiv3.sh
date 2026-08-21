# USAGE:
#   cd apps/app && sh bin/openapi/generate-spec-apiv3.sh
#   APP_PATH=/path/to/apps/app sh bin/openapi/generate-spec-apiv3.sh
#   APP_PATH=/path/to/apps/app OUT=/path/to/output sh bin/openapi/generate-spec-apiv3.sh
#
# APP_PATH may be absolute or relative in any form; growi-docs' api:build passes
# a bare relative `tmp/growi/apps/app`.

# Fail on the first failing step. The operationId injection below is what
# external consumers of this spec depend on, and it used to be able to fail
# while the script still exited 0 and printed a success message (#11634).
set -e

APP_PATH=${APP_PATH:-"."}

OUT=${OUT:-"${APP_PATH}/tmp/openapi-spec-apiv3.json"}

# `node --import` resolves its value as an ES module specifier, not as a
# filesystem path, so a bare relative form such as `tmp/growi/apps/app/...` is
# read as a *package name* and fails with ERR_MODULE_NOT_FOUND. Resolve APP_PATH
# to an absolute path once so every specifier below is unambiguous.
APP_PATH_ABS=$(cd "${APP_PATH}" && pwd)

swagger-jsdoc \
  -o "${OUT}" \
  -d "${APP_PATH}/bin/openapi/definition-apiv3.cjs" \
  "${APP_PATH}/src/features/external-user-group/server/routes/apiv3/*.ts" \
  "${APP_PATH}/src/features/templates/server/routes/apiv3/*.ts" \
  "${APP_PATH}/src/features/ai-tools/**/server/routes/apiv3/*.ts" \
  "${APP_PATH}/src/features/mastra/server/routes/admin-ai-settings/*.ts" \
  "${APP_PATH}/src/features/growi-plugin/server/routes/apiv3/**/*.ts" \
  "${APP_PATH}/src/features/revision-diff/server/routes/*.ts" \
  "${APP_PATH}/src/server/routes/apiv3/**/*.{js,ts}" \
  "${APP_PATH}/src/server/routes/login.js" \
  "${APP_PATH}/src/server/models/openapi/**/*.{js,ts}"

node --import "${APP_PATH_ABS}/bin/runtime/dev-esm-resolver.mjs" \
  "${APP_PATH_ABS}/bin/openapi/generate-operation-ids/cli.ts" \
  "${OUT}" --out "${OUT}" --overwrite-existing

# Check the finished artifact, not just the exit codes above: a generation step
# that exits 0 without doing its work would otherwise publish a spec whose
# operationIds are missing, silently renaming every symbol in the generated SDKs.
node --import "${APP_PATH_ABS}/bin/runtime/dev-esm-resolver.mjs" \
  "${APP_PATH_ABS}/bin/openapi/assert-operation-ids.ts" \
  "${OUT}"

echo "OpenAPI spec generated and transformed: ${OUT}"
