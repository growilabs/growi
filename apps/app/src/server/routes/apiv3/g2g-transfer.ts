import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Request, Router } from 'express';
import express from 'express';
import { body } from 'express-validator';
import { createReadStream } from 'fs';
import multer from 'multer';
import path from 'path';

import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { isG2GTransferError } from '~/server/models/vo/g2g-transfer-error';
import { configManager } from '~/server/service/config-manager';
import { exportService } from '~/server/service/export';
import type { IDataGROWIInfo } from '~/server/service/g2g-transfer';
import { X_GROWI_TRANSFER_KEY_HEADER_NAME } from '~/server/service/g2g-transfer';
import type { ImportSettings } from '~/server/service/import';
import { getImportService } from '~/server/service/import';
import loggerFactory from '~/utils/logger';
import { TransferKey } from '~/utils/vo/transfer-key';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import { Attachment } from '../../models/attachment';
import type { ApiV3Response } from './interfaces/apiv3-response';

interface AuthorizedRequest extends Request {
  user?: any;
}

const logger = loggerFactory('growi:routes:apiv3:transfer');

const validator = {
  transfer: [
    body('transferKey').isString().withMessage('transferKey is required'),
    body('collections').isArray().withMessage('collections is required'),
    body('optionsMap').isObject().withMessage('optionsMap is required'),
  ],
};

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      GrowiInfo:
 *        type: object
 *        properties:
 *           version:
 *             type: string
 *             description: The version of the GROWI
 *           userUpperLimit:
 *             type: number
 *             description: The upper limit of the number of users
 *           fileUploadDisabled:
 *             type: boolean
 *           fileUploadTotalLimit:
 *             type: number
 *             description: The total limit of the file upload size
 *           attachmentInfo:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *               writable:
 *                 type: boolean
 *               bucket:
 *                 type: string
 *               customEndpoint:
 *                 type: string
 *               uploadNamespace:
 *                 type: string
 *               accountName:
 *                 type: string
 *               containerName:
 *                 type: string
 */
/*
 * Routes
 */
module.exports = (crowi: Crowi): Router => {
  const {
    g2gTransferPusherService,
    g2gTransferReceiverService,
    growiBridgeService,
  } = crowi;

  const importService = getImportService();

  if (
    g2gTransferPusherService == null ||
    g2gTransferReceiverService == null ||
    exportService == null ||
    importService == null ||
    growiBridgeService == null ||
    configManager == null
  ) {
    throw Error('GROWI is not ready for g2g transfer');
  }

  const uploads = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, importService.baseDir);
      },
      filename(req, file, cb) {
        // to prevent hashing the file name. files with same name will be overwritten.
        cb(null, file.originalname);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (path.extname(file.originalname) === '.zip') {
        return cb(null, true);
      }
      cb(new Error('Only ".zip" is allowed'));
    },
  });

  const uploadsForAttachment = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, importService.baseDir);
      },
      filename(req, file, cb) {
        // to prevent hashing the file name. files with same name will be overwritten.
        cb(null, file.originalname);
      },
    }),
  });

  const isInstalled = configManager.getConfig('app:installed');

  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const loginRequiredStrictly = require('../../middlewares/login-required')(
    crowi,
  );

  // Middleware
  const adminRequiredIfInstalled = (
    req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    if (!isInstalled) {
      next();
      return;
    }

    return adminRequired(req, res, next);
  };

  // Middleware
  const appSiteUrlRequiredIfNotInstalled = (
    req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    if (!isInstalled && req.body.appSiteUrl != null) {
      next();
      return;
    }

    if (
      configManager.getConfig('app:siteUrl') != null ||
      req.body.appSiteUrl != null
    ) {
      next();
      return;
    }

    return res.apiv3Err(
      new ErrorV3(
        'Body param "appSiteUrl" is required when GROWI is NOT installed yet',
      ),
      400,
    );
  };

  // Local middleware to check if key is valid or not
  const validateTransferKey = async (
    req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    const transferKey = req.headers[X_GROWI_TRANSFER_KEY_HEADER_NAME] as string;

    try {
      await g2gTransferReceiverService.validateTransferKey(transferKey);
    } catch (err) {
      return res.apiv3Err(
        new ErrorV3('Invalid transfer key', 'invalid_transfer_key'),
        403,
      );
    }

    next();
  };

  const router = express.Router();
  const receiveRouter = express.Router();
  const pushRouter = express.Router();

  /**
   * @swagger
   *
   *  /g2g-transfer/files:
   *    get:
   *      summary: /g2g-transfer/files
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      responses:
   *        '200':
   *          description: Successfully got the list of files
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  files:
   *                    type: array
   *                    items:
   *                      type: object
   *                      properties:
   *                        name:
   *                          type: string
   *                          description: The name of the file
   *                        size:
   *                          type: number
   *                          description: The size of the file
   */
  receiveRouter.get(
    '/files',
    validateTransferKey,
    async (req: Request, res: ApiV3Response) => {
      const files = await crowi.fileUploadService.listFiles();
      return res.apiv3({ files });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer:
   *    post:
   *      summary: /g2g-transfer
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          multipart/form-data:
   *            schema:
   *              type: object
   *              properties:
   *                file:
   *                  type: string
   *                  format: binary
   *                  description: The zip file of the data to be transferred
   *                collections:
   *                  type: array
   *                  description: The list of MongoDB collections to be transferred
   *                  items:
   *                    type: string
   *                optionsMap:
   *                  type: object
   *                  description: The map of options for each collection
   *                operatorUserId:
   *                  type: string
   *                  description: The ID of the operator user
   *                uploadConfigs:
   *                  type: object
   *                  description: The map of upload configurations
   *      responses:
   *        '200':
   *          description: Successfully started to receive transfer data
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  message:
   *                    type: string
   *                    description: The message of the result
   */
  receiveRouter.post(
    '/',
    validateTransferKey,
    uploads.single('transferDataZipFile'),
    async (req: Request & { file: any }, res: ApiV3Response) => {
      const { file } = req;
      const {
        collections: strCollections,
        optionsMap: strOptionsMap,
        operatorUserId,
        uploadConfigs: strUploadConfigs,
      } = req.body;

      /*
       * parse multipart form data
       */
      let collections: string[];
      let optionsMap: { [key: string]: GrowiArchiveImportOption };
      let sourceGROWIUploadConfigs: any;
      try {
        collections = JSON.parse(strCollections);
        optionsMap = JSON.parse(strOptionsMap);
        sourceGROWIUploadConfigs = JSON.parse(strUploadConfigs);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Failed to parse request body.', 'parse_failed'),
          500,
        );
      }

      /*
       * unzip and parse
       */
      let meta: object | undefined;
      let innerFileStats: {
        fileName: string;
        collectionName: string;
        size: number;
      }[];
      try {
        const zipFile = importService.getFile(file.filename);
        await importService.unzip(zipFile);

        const zipFileStat = await growiBridgeService.parseZipFile(zipFile);
        innerFileStats = zipFileStat?.innerFileStats ?? [];
        meta = zipFileStat?.meta;
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to validate transfer data file.',
            'validation_failed',
          ),
          500,
        );
      }

      /*
       * validate meta.json
       */
      try {
        importService.validate(meta);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'The version of this GROWI and the uploaded GROWI data are not the same',
            'version_incompatible',
          ),
          500,
        );
      }

      /*
       * generate maps of ImportSettings to import
       */
      let importSettingsMap: Map<string, ImportSettings>;
      try {
        importSettingsMap = g2gTransferReceiverService.getImportSettingMap(
          innerFileStats,
          optionsMap,
          operatorUserId,
        );
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Import settings are invalid. See GROWI docs about details.',
            'import_settings_invalid',
          ),
        );
      }

      try {
        await g2gTransferReceiverService.importCollections(
          collections,
          importSettingsMap,
          sourceGROWIUploadConfigs,
        );
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to import MongoDB collections',
            'mongo_collection_import_failure',
          ),
          500,
        );
      }

      return res.apiv3({
        message: 'Successfully started to receive transfer data.',
      });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/attachment:
   *    post:
   *      summary: /g2g-transfer/attachment
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          multipart/form-data:
   *            schema:
   *              type: object
   *              properties:
   *                file:
   *                  type: string
   *                  format: binary
   *                  description: The zip file of the data to be transferred
   *                attachmentMetadata:
   *                  type: object
   *                  description: Metadata of the attachment
   *      responses:
   *        '200':
   *          description: Successfully imported attachment file
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  message:
   *                    type: string
   *                    description: The message of the result
   */
  // This endpoint uses multer's MemoryStorage since the received data should be persisted directly on attachment storage.
  receiveRouter.post(
    '/attachment',
    validateTransferKey,
    uploadsForAttachment.single('content'),
    async (req: Request & { file: any }, res: ApiV3Response) => {
      const { file } = req;
      const { attachmentMetadata } = req.body;

      let attachmentMap: { fileName: any; fileSize: any };
      try {
        attachmentMap = JSON.parse(attachmentMetadata);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Failed to parse body.', 'parse_failed'),
          500,
        );
      }

      try {
        const { fileName, fileSize } = attachmentMap;
        if (
          typeof fileName !== 'string' ||
          fileName.length === 0 ||
          fileName.length > 256
        ) {
          logger.warn('Invalid fileName in attachment metadata.', { fileName });
          return res.apiv3Err(
            new ErrorV3(
              'Invalid fileName in attachment metadata.',
              'invalid_metadata',
            ),
            400,
          );
        }
        if (
          typeof fileSize !== 'number' ||
          !Number.isInteger(fileSize) ||
          fileSize < 0
        ) {
          logger.warn('Invalid fileSize in attachment metadata.', { fileSize });
          return res.apiv3Err(
            new ErrorV3(
              'Invalid fileSize in attachment metadata.',
              'invalid_metadata',
            ),
            400,
          );
        }
        const count = await Attachment.countDocuments({ fileName, fileSize });
        if (count === 0) {
          logger.warn('Attachment not found in collection.', {
            fileName,
            fileSize,
          });
          return res.apiv3Err(
            new ErrorV3(
              'Attachment not found in collection.',
              'attachment_not_found',
            ),
            404,
          );
        }
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to check attachment existence.',
            'attachment_check_failed',
          ),
          500,
        );
      }

      const fileStream = createReadStream(file.path, {
        flags: 'r',
        mode: 0o666,
        autoClose: true,
      });
      try {
        await g2gTransferReceiverService.receiveAttachment(
          fileStream,
          attachmentMap,
        );
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Failed to upload.', 'upload_failed'),
          500,
        );
      }

      return res.apiv3({ message: 'Successfully imported attached file.' });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/growi-info:
   *    get:
   *      summary: /g2g-transfer/growi-info
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      responses:
   *        '200':
   *          description: Successfully got GROWI information
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  growiInfo:
   *                    $ref: '#/components/schemas/GrowiInfo'
   */
  receiveRouter.get(
    '/growi-info',
    validateTransferKey,
    async (req: Request, res: ApiV3Response) => {
      let growiInfo: IDataGROWIInfo;
      try {
        growiInfo = await g2gTransferReceiverService.answerGROWIInfo();
      } catch (err) {
        logger.error(err);

        if (!isG2GTransferError(err)) {
          return res.apiv3Err(
            new ErrorV3(
              'Failed to prepare GROWI info',
              'failed_to_prepare_growi_info',
            ),
            500,
          );
        }

        return res.apiv3Err(new ErrorV3(err.message, err.code), 500);
      }

      return res.apiv3({ growiInfo });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/generate-key:
   *    post:
   *      summary: /g2g-transfer/generate-key
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                appSiteUrl:
   *                  type: string
   *                  description: The URL of the GROWI
   *      responses:
   *        '200':
   *          description: Successfully generated transfer key
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  transferKey:
   *                    type: string
   *                    description: The transfer key
   */
  receiveRouter.post(
    '/generate-key',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXPORT_DATA], { acceptLegacy: true }),
    adminRequiredIfInstalled,
    appSiteUrlRequiredIfNotInstalled,
    async (req: Request, res: ApiV3Response) => {
      const appSiteUrl =
        req.body.appSiteUrl ?? configManager.getConfig('app:siteUrl');

      let appSiteUrlOrigin: string;
      try {
        appSiteUrlOrigin = new URL(appSiteUrl).origin;
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'appSiteUrl may be wrong',
            'failed_to_generate_key_string',
          ),
        );
      }

      // Save TransferKey document
      let transferKeyString: string;
      try {
        transferKeyString =
          await g2gTransferReceiverService.createTransferKey(appSiteUrlOrigin);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Error occurred while generating transfer key.',
            'failed_to_generate_key',
          ),
        );
      }

      return res.apiv3({ transferKey: transferKeyString });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/transfer:
   *    post:
   *      summary: /g2g-transfer/transfer
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                transferKey:
   *                  type: string
   *                  description: The transfer key
   *                collections:
   *                  type: array
   *                  description: The list of MongoDB collections to be transferred
   *                  items:
   *                    type: string
   *                optionsMap:
   *                  type: object
   *                  description: The map of options for each collection
   *      responses:
   *        '200':
   *          description: Successfully requested auto transfer
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  message:
   *                    type: string
   *                    description: The message of the result
   */
  pushRouter.post(
    '/transfer',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXPORT_DATA], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    validator.transfer,
    apiV3FormValidator,
    async (req: AuthorizedRequest, res: ApiV3Response) => {
      const { transferKey, collections, optionsMap } = req.body;

      // Parse transfer key
      let tk: TransferKey;
      try {
        tk = TransferKey.parse(transferKey);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Transfer key is invalid', 'transfer_key_invalid'),
          400,
        );
      }

      // get growi info
      let destGROWIInfo: IDataGROWIInfo;
      try {
        destGROWIInfo = await g2gTransferPusherService.askGROWIInfo(tk);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Error occurred while asking GROWI info.',
            'failed_to_ask_growi_info',
          ),
        );
      }

      // Check if can transfer
      const transferability =
        await g2gTransferPusherService.getTransferability(destGROWIInfo);
      if (!transferability.canTransfer) {
        return res.apiv3Err(
          new ErrorV3(transferability.reason, 'growi_incompatible_to_transfer'),
        );
      }

      // Start transfer
      // DO NOT "await". Let it run in the background.
      // Errors should be emitted through websocket.
      g2gTransferPusherService.startTransfer(
        tk,
        req.user,
        collections,
        optionsMap,
        destGROWIInfo,
      );

      return res.apiv3({ message: 'Successfully requested auto transfer.' });
    },
  );

  // Merge receiveRouter and pushRouter
  router.use(receiveRouter, pushRouter);

  return router;
};
