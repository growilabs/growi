import {
  SCOPE,
  toNonBlankString,
  toNonBlankStringOrUndefined,
} from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import { body } from 'express-validator';

import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { configManager } from '~/server/service/config-manager';
import { getTranslation } from '~/server/service/i18next';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../../middlewares/add-activity';
import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';

const logger = loggerFactory(
  'growi:routes:apiv3:app-settings:file-upload-setting',
);

const router = express.Router();

type BaseResponseParams = {
  fileUploadType: string;
};

type GcsResponseParams = BaseResponseParams & {
  gcsApiKeyJsonPath?: string;
  gcsBucket?: string;
  gcsUploadNamespace?: string;
  gcsReferenceFileWithRelayMode?: boolean;
};

type AwsResponseParams = BaseResponseParams & {
  s3Region?: string;
  s3CustomEndpoint?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3ReferenceFileWithRelayMode?: boolean;
};

type AzureResponseParams = BaseResponseParams & {
  azureTenantId?: string;
  azureClientId?: string;
  azureClientSecret?: string;
  azureStorageAccountName?: string;
  azureStorageContainerName?: string;
  azureReferenceFileWithRelayMode?: boolean;
};

type ResponseParams =
  | BaseResponseParams
  | GcsResponseParams
  | AwsResponseParams
  | AzureResponseParams;

const validator = {
  fileUploadSetting: [
    body('fileUploadType').isIn(['aws', 'gcs', 'local', 'gridfs', 'azure']),
    body('gcsApiKeyJsonPath').optional(),
    body('gcsBucket').optional(),
    body('gcsUploadNamespace').optional(),
    body('gcsReferenceFileWithRelayMode')
      .if((value) => value != null)
      .isBoolean(),
    body('s3Bucket').optional(),
    body('s3Region')
      .optional()
      .if((value) => value !== '' && value != null)
      .custom(async (value) => {
        const { t } = await getTranslation();
        if (!/^[a-z]+-[a-z]+-\d+$/.test(value)) {
          throw new Error(t('validation.aws_region'));
        }
        return true;
      }),
    body('s3CustomEndpoint')
      .optional()
      .if((value) => value !== '' && value != null)
      .custom(async (value) => {
        const { t } = await getTranslation();
        if (!/^(https?:\/\/[^/]+|)$/.test(value)) {
          throw new Error(t('validation.aws_custom_endpoint'));
        }
        return true;
      }),
    body('s3AccessKeyId')
      .optional()
      .if((value) => value !== '' && value != null)
      .matches(/^[\da-zA-Z]+$/),
    body('s3SecretAccessKey').optional(),
    body('s3ReferenceFileWithRelayMode')
      .if((value) => value != null)
      .isBoolean(),
    body('azureTenantId').optional(),
    body('azureClientId').optional(),
    body('azureClientSecret').optional(),
    body('azureStorageAccountName').optional(),
    body('azureStorageStorageName').optional(),
    body('azureReferenceFileWithRelayMode')
      .if((value) => value != null)
      .isBoolean(),
  ],
};

/**
 * @swagger
 *
 *    /app-settings/file-upload-settings:
 *      put:
 *        tags: [AppSettings]
 *        security:
 *          - cookieAuth: []
 *        summary: /app-settings/file-upload-setting
 *        description: Update fileUploadSetting
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                $ref: '#/components/schemas/FileUploadSettingParams'
 *        responses:
 *          200:
 *            description: Succeeded to update fileUploadSetting
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    responseParams:
 *                      type: object
 *                      $ref: '#/components/schemas/FileUploadSettingParams'
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../../middlewares/login-required')(
    crowi,
  );
  const adminRequired = require('../../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware();

  const activityEvent = crowi.event('activity');

  //  eslint-disable-next-line max-len
  router.put(
    '/',
    accessTokenParser([SCOPE.WRITE.ADMIN.APP]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.fileUploadSetting,
    apiV3FormValidator,
    async (req, res) => {
      const { fileUploadType } = req.body;

      if (fileUploadType === 'local' || fileUploadType === 'gridfs') {
        try {
          await configManager.updateConfigs(
            {
              'app:fileUploadType': fileUploadType,
            },
            { skipPubsub: true },
          );
        } catch (err) {
          const msg = `Error occurred in updating ${fileUploadType} settings: ${err.message}`;
          logger.error('Error', err);
          return res.apiv3Err(new ErrorV3(msg, 'update-fileUploadType-failed'));
        }
      }

      if (fileUploadType === 'aws') {
        try {
          try {
            toNonBlankString(req.body.s3Bucket);
          } catch (err) {
            throw new Error('S3 Bucket name is required');
          }
          try {
            toNonBlankString(req.body.s3Region);
          } catch (err) {
            throw new Error('S3 Region is required');
          }
          await configManager.updateConfigs(
            {
              'app:fileUploadType': fileUploadType,
              'aws:s3Region': toNonBlankString(req.body.s3Region),
              'aws:s3Bucket': toNonBlankString(req.body.s3Bucket),
              'aws:referenceFileWithRelayMode':
                req.body.s3ReferenceFileWithRelayMode,
            },
            { skipPubsub: true },
          );

          // Update optional non-secret fields (can be removed if undefined)
          await configManager.updateConfigs(
            {
              'aws:s3CustomEndpoint': toNonBlankStringOrUndefined(
                req.body.s3CustomEndpoint,
              ),
            },
            {
              skipPubsub: true,
              removeIfUndefined: true,
            },
          );

          // Update secret fields only if explicitly provided in request
          if (req.body.s3AccessKeyId !== undefined) {
            await configManager.updateConfigs(
              {
                'aws:s3AccessKeyId': toNonBlankStringOrUndefined(
                  req.body.s3AccessKeyId,
                ),
              },
              {
                skipPubsub: true,
                removeIfUndefined: true,
              },
            );
          }

          if (req.body.s3SecretAccessKey !== undefined) {
            await configManager.updateConfigs(
              {
                'aws:s3SecretAccessKey': toNonBlankStringOrUndefined(
                  req.body.s3SecretAccessKey,
                ),
              },
              {
                skipPubsub: true,
                removeIfUndefined: true,
              },
            );
          }
        } catch (err) {
          const msg = `Error occurred in updating AWS S3 settings: ${err.message}`;
          logger.error('Error', err);
          return res.apiv3Err(new ErrorV3(msg, 'update-fileUploadType-failed'));
        }
      }

      if (fileUploadType === 'gcs') {
        try {
          await configManager.updateConfigs(
            {
              'app:fileUploadType': fileUploadType,
              'gcs:referenceFileWithRelayMode':
                req.body.gcsReferenceFileWithRelayMode,
            },
            { skipPubsub: true },
          );

          // Update optional non-secret fields (can be removed if undefined)
          await configManager.updateConfigs(
            {
              'gcs:bucket': toNonBlankStringOrUndefined(req.body.gcsBucket),
              'gcs:uploadNamespace': toNonBlankStringOrUndefined(
                req.body.gcsUploadNamespace,
              ),
            },
            { skipPubsub: true, removeIfUndefined: true },
          );

          // Update secret fields only if explicitly provided in request
          if (req.body.gcsApiKeyJsonPath !== undefined) {
            await configManager.updateConfigs(
              {
                'gcs:apiKeyJsonPath': toNonBlankStringOrUndefined(
                  req.body.gcsApiKeyJsonPath,
                ),
              },
              { skipPubsub: true, removeIfUndefined: true },
            );
          }
        } catch (err) {
          const msg = `Error occurred in updating GCS settings: ${err.message}`;
          logger.error('Error', err);
          return res.apiv3Err(new ErrorV3(msg, 'update-fileUploadType-failed'));
        }
      }

      if (fileUploadType === 'azure') {
        try {
          await configManager.updateConfigs(
            {
              'app:fileUploadType': fileUploadType,
              'azure:referenceFileWithRelayMode':
                req.body.azureReferenceFileWithRelayMode,
            },
            { skipPubsub: true },
          );

          // Update optional non-secret fields (can be removed if undefined)
          await configManager.updateConfigs(
            {
              'azure:tenantId': toNonBlankStringOrUndefined(
                req.body.azureTenantId,
              ),
              'azure:clientId': toNonBlankStringOrUndefined(
                req.body.azureClientId,
              ),
              'azure:storageAccountName': toNonBlankStringOrUndefined(
                req.body.azureStorageAccountName,
              ),
              'azure:storageContainerName': toNonBlankStringOrUndefined(
                req.body.azureStorageContainerName,
              ),
            },
            { skipPubsub: true, removeIfUndefined: true },
          );

          // Update secret fields only if explicitly provided in request
          if (req.body.azureClientSecret !== undefined) {
            await configManager.updateConfigs(
              {
                'azure:clientSecret': toNonBlankStringOrUndefined(
                  req.body.azureClientSecret,
                ),
              },
              { skipPubsub: true, removeIfUndefined: true },
            );
          }
        } catch (err) {
          const msg = `Error occurred in updating Azure settings: ${err.message}`;
          logger.error('Error', err);
          return res.apiv3Err(new ErrorV3(msg, 'update-fileUploadType-failed'));
        }
      }

      try {
        await crowi.setUpFileUpload(true);
        crowi.fileUploaderSwitchService.publishUpdatedMessage();

        let responseParams: ResponseParams = {
          fileUploadType: configManager.getConfig('app:fileUploadType'),
        };

        if (fileUploadType === 'gcs') {
          responseParams = {
            fileUploadType: configManager.getConfig('app:fileUploadType'),
            gcsApiKeyJsonPath: configManager.getConfig('gcs:apiKeyJsonPath'),
            gcsBucket: configManager.getConfig('gcs:bucket'),
            gcsUploadNamespace: configManager.getConfig('gcs:uploadNamespace'),
            gcsReferenceFileWithRelayMode: configManager.getConfig(
              'gcs:referenceFileWithRelayMode',
            ),
          };
        }

        if (fileUploadType === 'aws') {
          responseParams = {
            fileUploadType: configManager.getConfig('app:fileUploadType'),
            s3Region: configManager.getConfig('aws:s3Region'),
            s3CustomEndpoint: configManager.getConfig('aws:s3CustomEndpoint'),
            s3Bucket: configManager.getConfig('aws:s3Bucket'),
            s3AccessKeyId: configManager.getConfig('aws:s3AccessKeyId'),
            s3ReferenceFileWithRelayMode: configManager.getConfig(
              'aws:referenceFileWithRelayMode',
            ),
          };
        }

        if (fileUploadType === 'azure') {
          responseParams = {
            fileUploadType: configManager.getConfig('app:fileUploadType'),
            azureTenantId: configManager.getConfig('azure:tenantId'),
            azureClientId: configManager.getConfig('azure:clientId'),
            azureClientSecret: configManager.getConfig('azure:clientSecret'),
            azureStorageAccountName: configManager.getConfig(
              'azure:storageAccountName',
            ),
            azureStorageContainerName: configManager.getConfig(
              'azure:storageContainerName',
            ),
            azureReferenceFileWithRelayMode: configManager.getConfig(
              'azure:referenceFileWithRelayMode',
            ),
          };
        }

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_FILE_UPLOAD_CONFIG_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ responseParams });
      } catch (err) {
        const msg = 'Error occurred in retrieving file upload configurations';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-fileUploadType-failed'));
      }
    },
  );

  return router;
};
