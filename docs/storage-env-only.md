# Storage configuration from environment variables

AWS S3, GCS, and Azure can use either administrator-managed database settings or environment-only settings. By default, database values take precedence over environment values. Enabling the corresponding flag makes the provider settings resolve only from environment variables and defaults, even if database values already exist.

- AWS S3: `AWS_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true`
- GCS: `GCS_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true`
- Azure: `AZURE_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true`

In environment-only mode, the admin form is read-only and the file-upload settings API does not write overrides for that provider. Disabling the flag restores database-first resolution; existing database settings are retained.

## AWS S3

The AWS flag controls these environment variables:

- `S3_BUCKET` (default: `growi`)
- `S3_REGION` (default: `ap-northeast-1`)
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_CUSTOM_ENDPOINT`
- `S3_REFERENCE_FILE_WITH_RELAY_MODE` (default: `false`)
- `S3_LIFETIME_SEC_FOR_TEMPORARY_URL` (default: `120`)
- `S3_OBJECT_ACL`

When access credentials are omitted, the S3 client uses the AWS SDK's default credential provider chain. Set a bucket and region appropriate for the deployment before enabling environment-only mode.

## GCS

The GCS flag controls `GCS_API_KEY_JSON_PATH`, `GCS_BUCKET`, `GCS_UPLOAD_NAMESPACE`, `GCS_REFERENCE_FILE_WITH_RELAY_MODE`, and `GCS_LIFETIME_SEC_FOR_TEMPORARY_URL`.

## Azure

The Azure flag controls `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_CONTAINER_NAME`, `AZURE_REFERENCE_FILE_WITH_RELAY_MODE`, and `AZURE_LIFETIME_SEC_FOR_TEMPORARY_URL`.

## Storage provider selection

These flags control provider-specific settings. To also fix the selected storage provider, set `FILE_UPLOAD_USES_ONLY_ENV_VAR_FOR_FILE_UPLOAD_TYPE=true` and set `FILE_UPLOAD` to the desired provider.
