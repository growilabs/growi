# USAGE:
#   cd apps/app && sh bin/openapi/generate-spec-apiv3.sh
#   APP_PATH=/path/to/apps/app sh bin/openapi/generate-spec-apiv3.sh
#   APP_PATH=/path/to/apps/app OUT=/path/to/output sh bin/openapi/generate-spec-apiv3.sh

APP_PATH=${APP_PATH:-"."}

OUT=${OUT:-"${APP_PATH}/tmp/openapi-spec-apiv3.json"}

swagger-jsdoc \
  -o "${OUT}" \
  -d "${APP_PATH}/bin/openapi/definition-apiv3.js" \
  "${APP_PATH}/src/features/external-user-group/server/routes/apiv3/*.ts" \
  "${APP_PATH}/src/features/templates/server/routes/apiv3/*.ts" \
  "${APP_PATH}/src/features/growi-plugin/server/routes/apiv3/**/*.ts" \
  "${APP_PATH}/src/server/routes/apiv3/**/*.{js,ts}" \
  "${APP_PATH}/src/server/routes/login.js" \
  "${APP_PATH}/src/server/models/openapi/**/*.{js,ts}"

if [ $? -eq 0 ]; then
  npx tsx "${APP_PATH}/bin/openapi/generate-operation-ids/cli.ts" "${OUT}" --out "${OUT}" --overwrite-existing
  echo "OpenAPI spec generated and transformed: ${OUT}"
fi
