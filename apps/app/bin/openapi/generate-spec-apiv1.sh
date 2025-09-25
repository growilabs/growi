# USAGE:
#   cd apps/app && sh bin/openapi/generate-spec-apiv1.sh
#   APP_PATH=/path/to/apps/app sh bin/openapi/generate-spec-apiv1.sh
#   APP_PATH=/path/to/apps/app OUT=/path/to/output sh bin/openapi/generate-spec-apiv1.sh

APP_PATH=${APP_PATH:-"."}

OUT=${OUT:-"${APP_PATH}/tmp/openapi-spec-apiv1.json"}

swagger-jsdoc \
  -o "${OUT}" \
  -d "${APP_PATH}/bin/openapi/definition-apiv1.js" \
  "${APP_PATH}/src/server/routes/*.{js,ts}" \
  "${APP_PATH}/src/server/routes/attachment/**/*.{js,ts}" \
  "${APP_PATH}/src/server/models/openapi/**/*.{js,ts}"
