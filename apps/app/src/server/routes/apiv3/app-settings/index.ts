import {
  ConfigSource, SCOPE,
} from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { body } from 'express-validator';

import { i18n } from '^/config/next-i18next.config';

import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { configManager } from '~/server/service/config-manager';
import { getTranslation } from '~/server/service/i18next';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../../middlewares/add-activity';
import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';


const logger = loggerFactory('growi:routes:apiv3:app-settings');

const { pathUtils } = require('@growi/core/dist/utils');
const express = require('express');

const router = express.Router();


/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      AppSettingParams:
 *        description: AppSettingParams
 *        type: object
 *        properties:
 *          azureReferenceFileWithRelayMode:
 *            type: boolean
 *            example: false
 *          azureUseOnlyEnvVars:
 *            type: boolean
 *            example: false
 *          confidential:
 *            type: string
 *            description: confidential show on page header
 *            example: 'GROWI'
 *          envAzureClientId:
 *            type: string
 *            example: 'AZURE_CLIENT_ID'
 *          envAzureClientSecret:
 *            type: string
 *            example: 'AZURE_CLIENT_SECRET'
 *          envAzureStorageAccountName:
 *           type: string
 *           example: 'AZURE_STORAGE_ACCOUNT_NAME'
 *          envAzureStorageContainerName:
 *            type: string
 *            example: 'AZURE_STORAGE_CONTAINER_NAME'
 *          envFileUploadType:
 *            type: string
 *            example: 'mongodb'
 *          envGcsApiKeyJsonPath:
 *            type: string
 *            example: 'GCS_API_KEY_JSON_PATH'
 *          envGcsBucket:
 *            type: string
 *            example: 'GCS_BUCKET'
 *          envGcsUploadNamespace:
 *            type: string
 *            example: 'GCS_UPLOAD_NAMESPACE'
 *          envSiteUrl:
 *            type: string
 *            example: 'http://localhost:3000'
 *          fileUpload:
 *            type: boolean
 *            example: true
 *          fileUploadType:
 *            type: string
 *            example: 'local'
 *          fromAddress:
 *            type: string
 *            example: info@growi.org
 *          gcsApiKeyJsonPath:
 *            type: string
 *            example: 'GCS_API_KEY_JSON_PATH'
 *          gcsBucket:
 *            type: string
 *            example: 'GCS_BUCKET'
 *          gcsReferenceFileWithRelayMode:
 *            type: boolean
 *            example: false
 *          gcsUploadNamespace:
 *            type: string
 *            example: 'GCS_UPLOAD_NAMESPACE'
 *          gcsUseOnlyEnvVars:
 *            type: boolean
 *            example: false
 *          globalLang:
 *            type: string
 *            example: 'ja_JP'
 *          isAppSiteUrlHashed:
 *            type: boolean
 *            example: false
 *          isEmailPublishedForNewUser:
 *            type: boolean
 *            example: true
 *          isMaintenanceMode:
 *            type: boolean
 *            example: false
 *          isV5Compatible:
 *            type: boolean
 *            example: true
 *          s3AccessKeyId:
 *            type: string
 *          s3Bucket:
 *            type: string
 *          s3CustomEndpoint:
 *            type: string
 *          s3ReferenceFileWithRelayMode:
 *            type: boolean
 *          s3Region:
 *            type: string
 *          siteUrl:
 *            type: string
 *          siteUrlUseOnlyEnvVars:
 *            type: boolean
 *          smtpHost:
 *            type: string
 *          smtpPassword:
 *            type: string
 *          smtpPort:
 *            type: string
 *          smtpUser:
 *            type: string
 *          useOnlyEnvVarForFileUploadType:
 *            type: boolean
 *      AppSettingPutParams:
 *        description: AppSettingPutParams
 *        type: object
 *        properties:
 *          title:
 *            type: string
 *            description: title of the site
 *            example: 'GROWI'
 *          confidential:
 *            type: string
 *            description: confidential show on page header
 *            example: 'GROWI'
 *          globalLang:
 *            type: string
 *            description: global language
 *            example: 'ja_JP'
 *          isEmailPublishedForNewUser:
 *            type: boolean
 *            description: is email published for new user, or not
 *            example: true
 *          fileUpload:
 *            type: boolean
 *            description: is file upload enabled, or not
 *            example: true
 *      SiteUrlSettingParams:
 *        description: SiteUrlSettingParams
 *        type: object
 *        properties:
 *          siteUrl:
 *            type: string
 *            description: Site URL. e.g. https://example.com, https://example.com:8080
 *          envSiteUrl:
 *            type: string
 *            description: environment variable 'APP_SITE_URL'
 *      SmtpSettingParams:
 *        description: SmtpSettingParams
 *        type: object
 *        properties:
 *          smtpHost:
 *            type: string
 *            description: host name of client's smtp server
 *            example: 'smtp.example.com'
 *          smtpPort:
 *            type: string
 *            description: port of client's smtp server
 *            example: '587'
 *          smtpUser:
 *            type: string
 *            description: user name of client's smtp server
 *            example: 'USER'
 *          smtpPassword:
 *            type: string
 *            description: password of client's smtp server
 *            example: 'PASSWORD'
 *          fromAddress:
 *            type: string
 *            description: e-mail address
 *            example: 'info@example.com'
 *      SmtpSettingResponseParams:
 *        description: SmtpSettingResponseParams
 *        type: object
 *        properties:
 *          isMailerSetup:
 *            type: boolean
 *            description: is mailer setup, or not
 *            example: true
 *          smtpHost:
 *            type: string
 *            description: host name of client's smtp server
 *            example: 'smtp.example.com'
 *          smtpPort:
 *            type: string
 *            description: port of client's smtp server
 *            example: '587'
 *          smtpUser:
 *            type: string
 *            description: user name of client's smtp server
 *            example: 'USER'
 *          smtpPassword:
 *            type: string
 *            description: password of client's smtp server
 *            example: 'PASSWORD'
 *          fromAddress:
 *            type: string
 *            description: e-mail address
 *            example: 'info@example.com'
 *      SesSettingParams:
 *        description: SesSettingParams
 *        type: object
 *        properties:
 *          from:
 *            type: string
 *            description: e-mail address used as from address of mail which sent from GROWI app
 *            example: 'info@growi.org'
 *          transmissionMethod:
 *            type: string
 *            description: transmission method
 *            example: 'ses'
 *          sesAccessKeyId:
 *            type: string
 *            description: accesskey id for authentification of AWS
 *          sesSecretAccessKey:
 *            type: string
 *            description: secret key for authentification of AWS
 *      SesSettingResponseParams:
 *        description: SesSettingParams
 *        type: object
 *        properties:
 *          isMailerSetup:
 *            type: boolean
 *            description: is mailer setup, or not
 *            example: true
 *          from:
 *            type: string
 *            description: e-mail address used as from address of mail which sent from GROWI app
 *            example: 'info@growi.org'
 *          transmissionMethod:
 *            type: string
 *            description: transmission method
 *            example: 'ses'
 *          sesAccessKeyId:
 *            type: string
 *            description: accesskey id for authentification of AWS
 *          sesSecretAccessKey:
 *            type: string
 *            description: secret key for authentification of AWS
 *      FileUploadSettingParams:
 *        description: FileUploadTypeParams
 *        type: object
 *        properties:
 *          fileUploadType:
 *            type: string
 *            description: fileUploadType
 *          s3Region:
 *            type: string
 *            description: region of AWS S3
 *          s3CustomEndpoint:
 *            type: string
 *            description: custom endpoint of AWS S3
 *          s3Bucket:
 *            type: string
 *            description: AWS S3 bucket name
 *          s3AccessKeyId:
 *            type: string
 *            description: accesskey id for authentification of AWS
 *          s3SecretAccessKey:
 *            type: string
 *            description: secret key for authentification of AWS
 *          s3ReferenceFileWithRelayMode:
 *            type: boolean
 *            description: is enable internal stream system for s3 file request
 *          gcsApiKeyJsonPath:
 *            type: string
 *            description: apiKeyJsonPath of gcp
 *          gcsBucket:
 *            type: string
 *            description: bucket name of gcs
 *          gcsUploadNamespace:
 *            type: string
 *            description: name space of gcs
 *          gcsReferenceFileWithRelayMode:
 *            type: boolean
 *            description: is enable internal stream system for gcs file request
 *          azureTenantId:
 *            type: string
 *            description: tenant id of azure
 *          azureClientId:
 *            type: string
 *            description: client id of azure
 *          azureClientSecret:
 *            type: string
 *            description: client secret of azure
 *          azureStorageAccountName:
 *            type: string
 *            description: storage account name of azure
 *          azureStorageContainerName:
 *            type: string
 *            description: storage container name of azure
 *          azureReferenceFileWithRelayMode:
 *            type: boolean
 *            description: is enable internal stream system for azure file request
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../../middlewares/login-required')(crowi);
  const adminRequired = require('../../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware();

  const activityEvent = crowi.event('activity');

  const validator = {
    appSetting: [
      body('title').trim(),
      body('confidential'),
      body('globalLang').isIn(i18n.locales),
      body('isEmailPublishedForNewUser').isBoolean(),
      body('fileUpload').isBoolean(),
    ],
    siteUrlSetting: [
      // https://regex101.com/r/5Xef8V/1
      body('siteUrl').trim().matches(/^(https?:\/\/)/).isURL({ require_tld: false }),
    ],
    mailSetting: [
      body('fromAddress').trim().if(value => value !== '').isEmail(),
      body('transmissionMethod').isIn(['smtp', 'ses']),
    ],
    smtpSetting: [
      body('smtpHost').trim(),
      body('smtpPort').trim().if(value => value !== '').isPort(),
      body('smtpUser').trim(),
      body('smtpPassword').trim(),
    ],
    sesSetting: [
      body('sesAccessKeyId').trim().if(value => value !== '').matches(/^[\da-zA-Z]+$/),
      body('sesSecretAccessKey').trim(),
    ],
    pageBulkExportSettings: [
      body('isBulkExportPagesEnabled').isBoolean(),
      body('bulkExportDownloadExpirationSeconds').isInt(),
    ],
    maintenanceMode: [
      body('flag').isBoolean(),
    ],
  };

  /**
   * @swagger
   *
   *    /app-settings:
   *      get:
   *        tags: [AppSettings]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: /app-settings
   *        description: get app setting params
   *        responses:
   *          200:
   *            description: Resources are available
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    appSettingsParams:
   *                      type: object
   *                      $ref: '#/components/schemas/AppSettingParams'
   */
  router.get('/', accessTokenParser([SCOPE.READ.ADMIN.APP], { acceptLegacy: true }), loginRequiredStrictly, adminRequired, async(req, res) => {
    const appSettingsParams = {
      title: configManager.getConfig('app:title'),
      confidential: configManager.getConfig('app:confidential'),
      globalLang: configManager.getConfig('app:globalLang'),
      isEmailPublishedForNewUser: configManager.getConfig('customize:isEmailPublishedForNewUser'),
      fileUpload: configManager.getConfig('app:fileUpload'),
      useOnlyEnvVarsForIsBulkExportPagesEnabled: configManager.getConfig('env:useOnlyEnvVars:app:isBulkExportPagesEnabled'),
      isV5Compatible: configManager.getConfig('app:isV5Compatible'),
      siteUrl: configManager.getConfig('app:siteUrl'),
      siteUrlUseOnlyEnvVars: configManager.getConfig('env:useOnlyEnvVars:app:siteUrl'),
      envSiteUrl: configManager.getConfig('app:siteUrl', ConfigSource.env),
      isMailerSetup: crowi.mailService.isMailerSetup,
      fromAddress: configManager.getConfig('mail:from'),

      transmissionMethod: configManager.getConfig('mail:transmissionMethod'),
      smtpHost: configManager.getConfig('mail:smtpHost'),
      smtpPort: configManager.getConfig('mail:smtpPort'),
      smtpUser: configManager.getConfig('mail:smtpUser'),
      smtpPassword: configManager.getConfig('mail:smtpPassword'),
      sesAccessKeyId: configManager.getConfig('mail:sesAccessKeyId'),
      sesSecretAccessKey: configManager.getConfig('mail:sesSecretAccessKey'),

      fileUploadType: configManager.getConfig('app:fileUploadType'),
      envFileUploadType: configManager.getConfig('app:fileUploadType', ConfigSource.env),
      useOnlyEnvVarForFileUploadType: configManager.getConfig('env:useOnlyEnvVars:app:fileUploadType'),

      s3Region: configManager.getConfig('aws:s3Region'),
      s3CustomEndpoint: configManager.getConfig('aws:s3CustomEndpoint'),
      s3Bucket: configManager.getConfig('aws:s3Bucket'),
      s3AccessKeyId: configManager.getConfig('aws:s3AccessKeyId'),
      s3ReferenceFileWithRelayMode: configManager.getConfig('aws:referenceFileWithRelayMode'),

      gcsUseOnlyEnvVars: configManager.getConfig('env:useOnlyEnvVars:gcs'),
      gcsApiKeyJsonPath: configManager.getConfig('gcs:apiKeyJsonPath'),
      gcsBucket: configManager.getConfig('gcs:bucket'),
      gcsUploadNamespace: configManager.getConfig('gcs:uploadNamespace'),
      gcsReferenceFileWithRelayMode: configManager.getConfig('gcs:referenceFileWithRelayMode'),

      envGcsApiKeyJsonPath: configManager.getConfig('gcs:apiKeyJsonPath', ConfigSource.env),
      envGcsBucket: configManager.getConfig('gcs:bucket', ConfigSource.env),
      envGcsUploadNamespace: configManager.getConfig('gcs:uploadNamespace', ConfigSource.env),

      azureUseOnlyEnvVars: configManager.getConfig('env:useOnlyEnvVars:azure'),
      azureTenantId: configManager.getConfig('azure:tenantId', ConfigSource.db),
      azureClientId: configManager.getConfig('azure:clientId', ConfigSource.db),
      azureClientSecret: configManager.getConfig('azure:clientSecret', ConfigSource.db),
      azureStorageAccountName: configManager.getConfig('azure:storageAccountName', ConfigSource.db),
      azureStorageContainerName: configManager.getConfig('azure:storageContainerName', ConfigSource.db),
      azureReferenceFileWithRelayMode: configManager.getConfig('azure:referenceFileWithRelayMode'),

      envAzureTenantId: configManager.getConfig('azure:tenantId', ConfigSource.env),
      envAzureClientId: configManager.getConfig('azure:clientId', ConfigSource.env),
      envAzureClientSecret: configManager.getConfig('azure:clientSecret', ConfigSource.env),
      envAzureStorageAccountName: configManager.getConfig('azure:storageAccountName', ConfigSource.env),
      envAzureStorageContainerName: configManager.getConfig('azure:storageContainerName', ConfigSource.env),

      isMaintenanceMode: configManager.getConfig('app:isMaintenanceMode'),

      isBulkExportPagesEnabled: configManager.getConfig('app:isBulkExportPagesEnabled'),
      envIsBulkExportPagesEnabled: configManager.getConfig('app:isBulkExportPagesEnabled'),
      bulkExportDownloadExpirationSeconds: configManager.getConfig('app:bulkExportDownloadExpirationSeconds'),
    };
    return res.apiv3({ appSettingsParams });

  });

  /**
   * @swagger
   *
   *    /app-settings/app-setting:
   *      put:
   *        tags: [AppSettings]
   *        security:
   *          - cookieAuth: []
   *        summary: /app-settings/app-setting
   *        description: Update app setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/AppSettingPutParams'
   *        responses:
   *          200:
   *            description: Succeeded to update app setting
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    appSettingParams:
   *                      type: object
   *                      $ref: '#/components/schemas/AppSettingPutParams'
   */
  router.put('/app-setting', accessTokenParser([SCOPE.WRITE.ADMIN.APP]), loginRequiredStrictly, adminRequired, addActivity,
    validator.appSetting, apiV3FormValidator,
    async(req, res) => {
      const requestAppSettingParams = {
        'app:title': req.body.title,
        'app:confidential': req.body.confidential,
        'app:globalLang': req.body.globalLang,
        'customize:isEmailPublishedForNewUser': req.body.isEmailPublishedForNewUser,
        'app:fileUpload': req.body.fileUpload,
      };

      try {
        await configManager.updateConfigs(requestAppSettingParams);
        const appSettingParams = {
          title: configManager.getConfig('app:title'),
          confidential: configManager.getConfig('app:confidential'),
          globalLang: configManager.getConfig('app:globalLang'),
          isEmailPublishedForNewUser: configManager.getConfig('customize:isEmailPublishedForNewUser'),
          fileUpload: configManager.getConfig('app:fileUpload'),
        };

        const parameters = { action: SupportedAction.ACTION_ADMIN_APP_SETTINGS_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ appSettingParams });
      }
      catch (err) {
        const msg = 'Error occurred in updating app setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-appSetting-failed'));
      }

    });

  /**
   * @swagger
   *
   *    /app-settings/site-url-setting:
   *      put:
   *        tags: [AppSettings]
   *        security:
   *          - cookieAuth: []
   *        summary: /app-settings/site-url-setting
   *        description: Update site url setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/SiteUrlSettingParams'
   *        responses:
   *          200:
   *            description: Succeeded to update site url setting
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    siteUrlSettingParams:
   *                      type: object
   *                      properties:
   *                        siteUrl:
   *                          type: string
   *                          description: Site URL. e.g. https://example.com, https://example.com:3000
   *                          example: 'http://localhost:3000'
   */
  router.put('/site-url-setting', accessTokenParser([SCOPE.WRITE.ADMIN.APP]), loginRequiredStrictly, adminRequired, addActivity,
    validator.siteUrlSetting, apiV3FormValidator,
    async(req, res) => {
      const useOnlyEnvVars = configManager.getConfig('env:useOnlyEnvVars:app:siteUrl');

      if (useOnlyEnvVars) {
        const msg = 'Updating the Site URL is prohibited on this system.';
        return res.apiv3Err(new ErrorV3(msg, 'update-siteUrlSetting-prohibited'));
      }

      const requestSiteUrlSettingParams = {
        'app:siteUrl': pathUtils.removeTrailingSlash(req.body.siteUrl),
      };

      try {
        await configManager.updateConfigs(requestSiteUrlSettingParams);
        const siteUrlSettingParams = {
          siteUrl: configManager.getConfig('app:siteUrl'),
        };

        const parameters = { action: SupportedAction.ACTION_ADMIN_SITE_URL_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ siteUrlSettingParams });
      }
      catch (err) {
        const msg = 'Error occurred in updating site url setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-siteUrlSetting-failed'));
      }

    });

  /**
   * send mail (Promise wrapper)
   */
  async function sendMailPromiseWrapper(smtpClient, options) {
    return new Promise((resolve, reject) => {
      smtpClient.sendMail(options, (err, res) => {
        if (err) {
          reject(err);
        }
        else {
          resolve(res);
        }
      });
    });
  }

  /**
   * validate mail setting send test mail
   */
  async function sendTestEmail(destinationAddress) {

    const { mailService } = crowi;

    if (!mailService.isMailerSetup) {
      throw Error('mailService is not setup');
    }

    const fromAddress = configManager.getConfig('mail:from');
    if (fromAddress == null) {
      throw Error('fromAddress is not setup');
    }

    const smtpHost = configManager.getConfig('mail:smtpHost');
    const smtpPort = configManager.getConfig('mail:smtpPort');
    const smtpUser = configManager.getConfig('mail:smtpUser');
    const smtpPassword = configManager.getConfig('mail:smtpPassword');

    // Define the option object with possible 'auth' and 'secure' properties
    const option: {
      host: string | undefined;
      port: string | undefined;
      auth?: { user: string; pass: string };
      secure?: boolean;
    } = {
      host: smtpHost,
      port: smtpPort,
    };
    if (smtpUser && smtpPassword) {
      option.auth = {
        user: smtpUser,
        pass: smtpPassword,
      };
    }
    if (option.port === '465') {
      option.secure = true;
    }

    const smtpClient = mailService.createSMTPClient(option);
    logger.debug('mailer setup for validate SMTP setting', smtpClient);

    const mailOptions = {
      from: fromAddress,
      to: destinationAddress,
      subject: 'Wiki管理設定のアップデートによるメール通知',
      text: 'このメールは、WikiのSMTP設定のアップデートにより送信されています。',
    };

    await sendMailPromiseWrapper(smtpClient, mailOptions);
  }

  const updateMailSettinConfig = async function(requestMailSettingParams) {
    const {
      mailService,
    } = crowi;

    // update config without publishing S2sMessage
    await configManager.updateConfigs(requestMailSettingParams, { skipPubsub: true });

    await mailService.initialize();
    mailService.publishUpdatedMessage();

    return {
      isMailerSetup: mailService.isMailerSetup,
      fromAddress: configManager.getConfig('mail:from'),
      smtpHost: configManager.getConfig('mail:smtpHost'),
      smtpPort: configManager.getConfig('mail:smtpPort'),
      smtpUser: configManager.getConfig('mail:smtpUser'),
      smtpPassword: configManager.getConfig('mail:smtpPassword'),
      sesAccessKeyId: configManager.getConfig('mail:sesAccessKeyId'),
      sesSecretAccessKey: configManager.getConfig('mail:sesSecretAccessKey'),
    };
  };

  /**
   * @swagger
   *
   *    /app-settings/smtp-setting:
   *      put:
   *        tags: [AppSettings]
   *        security:
   *          - cookieAuth: []
   *        summary: /app-settings/smtp-setting
   *        description: Update smtp setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/SmtpSettingParams'
   *        responses:
   *          200:
   *            description: Succeeded to update smtp setting
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    mailSettingParams:
   *                      type: object
   *                      $ref: '#/components/schemas/SmtpSettingResponseParams'
   */
  router.put('/smtp-setting', accessTokenParser([SCOPE.WRITE.ADMIN.APP]), loginRequiredStrictly, adminRequired, addActivity,
    validator.smtpSetting, apiV3FormValidator,
    async(req, res) => {
      const requestMailSettingParams = {
        'mail:from': req.body.fromAddress,
        'mail:transmissionMethod': req.body.transmissionMethod,
        'mail:smtpHost': req.body.smtpHost,
        'mail:smtpPort': req.body.smtpPort,
        'mail:smtpUser': req.body.smtpUser,
        'mail:smtpPassword': req.body.smtpPassword,
      };

      try {
        const mailSettingParams = await updateMailSettinConfig(requestMailSettingParams);
        const parameters = { action: SupportedAction.ACTION_ADMIN_MAIL_SMTP_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ mailSettingParams });
      }
      catch (err) {
        const msg = 'Error occurred in updating smtp setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-smtpSetting-failed'));
      }
    });

  /**
   * @swagger
   *
   *    /app-settings/smtp-test:
   *      post:
   *        tags: [AppSettings]
   *        security:
   *          - cookieAuth: []
   *        summary: /app-settings/smtp-setting
   *        description: Send test mail for smtp
   *        responses:
   *          200:
   *            description: Succeeded to send test mail for smtp
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  description: Empty object
   */
  router.post('/smtp-test', accessTokenParser([SCOPE.WRITE.ADMIN.APP]), loginRequiredStrictly, adminRequired, addActivity, async(req, res) => {
    const { t } = await getTranslation({ lang: req.user.lang });

    try {
      await sendTestEmail(req.user.email);
      const parameters = { action: SupportedAction.ACTION_ADMIN_MAIL_TEST_SUBMIT };
      activityEvent.emit('update', res.locals.activity._id, parameters);
      return res.apiv3({});
    }
    catch (err) {
      const msg = t('validation.failed_to_send_a_test_email');
      logger.error('Error', err);
      logger.debug('Error validate mail setting: ', err);
      return res.apiv3Err(new ErrorV3(msg, 'send-email-with-smtp-failed'));
    }
  });

  /**
   * @swagger
   *
   *    /app-settings/ses-setting:
   *      put:
   *        tags: [AppSettings]
   *        security:
   *          - cookieAuth: []
   *        summary: /app-settings/ses-setting
   *        description: Update ses setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/SesSettingParams'
   *        responses:
   *          200:
   *            description: Succeeded to update ses setting
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/SesSettingResponseParams'
   */
  router.put('/ses-setting', accessTokenParser([SCOPE.WRITE.ADMIN.APP]), loginRequiredStrictly, adminRequired, addActivity,
    validator.sesSetting, apiV3FormValidator,
    async(req, res) => {
      const { mailService } = crowi;

      const requestSesSettingParams = {
        'mail:from': req.body.fromAddress,
        'mail:transmissionMethod': req.body.transmissionMethod,
        'mail:sesAccessKeyId': req.body.sesAccessKeyId,
        'mail:sesSecretAccessKey': req.body.sesSecretAccessKey,
      };

      let mailSettingParams;
      try {
        mailSettingParams = await updateMailSettinConfig(requestSesSettingParams);
      }
      catch (err) {
        const msg = 'Error occurred in updating ses setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-ses-setting-failed'));
      }

      await mailService.initialize();
      mailService.publishUpdatedMessage();
      const parameters = { action: SupportedAction.ACTION_ADMIN_MAIL_SES_UPDATE };
      activityEvent.emit('update', res.locals.activity._id, parameters);
      return res.apiv3({ mailSettingParams });
    });

  router.use('/file-upload-setting', require('./file-upload-setting')(crowi));


  router.put('/page-bulk-export-settings',
    accessTokenParser([SCOPE.WRITE.ADMIN.APP]), loginRequiredStrictly, adminRequired, addActivity, validator.pageBulkExportSettings, apiV3FormValidator,
    async(req, res) => {
      const requestParams = {
        'app:isBulkExportPagesEnabled': req.body.isBulkExportPagesEnabled,
        'app:bulkExportDownloadExpirationSeconds': req.body.bulkExportDownloadExpirationSeconds,
      };

      try {
        await configManager.updateConfigs(requestParams, { skipPubsub: true });
        const responseParams = {
          isBulkExportPagesEnabled: configManager.getConfig('app:isBulkExportPagesEnabled'),
          bulkExportDownloadExpirationSeconds: configManager.getConfig('app:bulkExportDownloadExpirationSeconds'),
        };

        const parameters = { action: SupportedAction.ACTION_ADMIN_APP_SETTINGS_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ responseParams });
      }
      catch (err) {
        const msg = 'Error occurred in updating page bulk export settings';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-page-bulk-export-settings-failed'));
      }

    });

  /**
   * @swagger
   *
   *    /app-settings/v5-schema-migration:
   *      post:
   *        tags: [AppSettings]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: AccessToken supported.
   *        description: Update V5SchemaMigration
   *        responses:
   *          200:
   *            description: Succeeded to get V5SchemaMigration
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    isV5Compatible:
   *                      type: boolean
   *                      description: is V5 compatible, or not
   *                      example: true
   */
  router.post('/v5-schema-migration',
    accessTokenParser([SCOPE.WRITE.ADMIN.APP], { acceptLegacy: true }), loginRequiredStrictly, adminRequired, async(req, res) => {
      const isMaintenanceMode = crowi.appService.isMaintenanceMode();
      if (!isMaintenanceMode) {
        return res.apiv3Err(new ErrorV3('GROWI is not maintenance mode. To import data, please activate the maintenance mode first.', 'not_maintenance_mode'));
      }

      const isV5Compatible = configManager.getConfig('app:isV5Compatible');

      try {
        if (!isV5Compatible) {
        // This method throws and emit socketIo event when error occurs
          crowi.pageService.normalizeAllPublicPages();
        }
      }
      catch (err) {
        return res.apiv3Err(new ErrorV3(`Failed to migrate pages: ${err.message}`), 500);
      }

      return res.apiv3({ isV5Compatible });
    });

  /**
   * @swagger
   *
   *    /app-settings/maintenance-mode:
   *      post:
   *        tags: [AppSettings]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: AccessToken supported.
   *        description: Update MaintenanceMode
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  flag:
   *                    type: boolean
   *                    description: flag for maintenance mode
   *        responses:
   *          200:
   *            description: Succeeded to update MaintenanceMode
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    flag:
   *                      type: boolean
   *                      description: true if maintenance mode is enabled
   *                      example: true
   */
  router.post('/maintenance-mode',
    accessTokenParser([SCOPE.WRITE.ADMIN.APP], { acceptLegacy: true }),
    loginRequiredStrictly, adminRequired, addActivity, validator.maintenanceMode, apiV3FormValidator, async(req, res) => {
      const { flag } = req.body;
      const parameters = {};
      try {
        if (flag) {
          await crowi.appService.startMaintenanceMode();
          Object.assign(parameters, { action: SupportedAction.ACTION_ADMIN_MAINTENANCEMODE_ENABLED });
        }
        else {
          await crowi.appService.endMaintenanceMode();
          Object.assign(parameters, { action: SupportedAction.ACTION_ADMIN_MAINTENANCEMODE_DISABLED });
        }
      }
      catch (err) {
        logger.error(err);
        if (flag) {
          res.apiv3Err(new ErrorV3('Failed to start maintenance mode', 'failed_to_start_maintenance_mode'), 500);
        }
        else {
          res.apiv3Err(new ErrorV3('Failed to end maintenance mode', 'failed_to_end_maintenance_mode'), 500);
        }
      }

      if ('action' in parameters) {
        activityEvent.emit('update', res.locals.activity._id, parameters);
      }

      res.apiv3({ flag });
    });

  return router;
};
