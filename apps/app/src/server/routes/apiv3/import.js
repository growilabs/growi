import { ErrorV3 } from '@growi/core/dist/models';

import { SupportedAction } from '~/interfaces/activity';
import { SCOPE } from '@growi/core/dist/interfaces';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { getImportService } from '~/server/service/import';
import { generateOverwriteParams } from '~/server/service/import/overwrite-params';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';

const logger = loggerFactory('growi:routes:apiv3:import'); // eslint-disable-line no-unused-vars

const path = require('path');

const express = require('express');
const multer = require('multer');


const router = express.Router();

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      GrowiArchiveImportOption:
 *        description: GrowiArchiveImportOption
 *        type: object
 *        properties:
 *          mode:
 *            description: Import mode
 *            type: string
 *            enum: [insert, upsert, flushAndInsert]
 *      ImportStatus:
 *        description: ImportStatus
 *        type: object
 *        properties:
 *          isTheSameVersion:
 *            type: boolean
 *            description: whether the version of the uploaded data is the same as the current GROWI version
 *          zipFileStat:
 *            type: object
 *            description: the property object
 *          progressList:
 *            type: array
 *            items:
 *              type: object
 *              description: progress data for each exporting collections
 *          isImporting:
 *            type: boolean
 *            description: whether the current importing job exists or not
 *      FileImportResponse:
 *        type: object
 *        properties:
 *          meta:
 *            type: object
 *            properties:
 *              version:
 *                type: string
 *              url:
 *                type: string
 *              passwordSeed:
 *                type: string
 *              exportedAt:
 *                type: string
 *                format: date-time
 *              envVars:
 *                type: object
 *                properties:
 *                  ELASTICSEARCH_URI:
 *                    type: string
 *          fileName:
 *            type: string
 *          zipFilePath:
 *            type: string
 *          fileStat:
 *            type: object
 *            properties:
 *              dev:
 *                type: integer
 *              mode:
 *                type: integer
 *              nlink:
 *                type: integer
 *              uid:
 *                type: integer
 *              gid:
 *                type: integer
 *              rdev:
 *                type: integer
 *              blksize:
 *                type: integer
 *              ino:
 *                type: integer
 *              size:
 *                type: integer
 *              blocks:
 *                type: integer
 *              atime:
 *                type: string
 *                format: date-time
 *              mtime:
 *                type: string
 *                format: date-time
 *              ctime:
 *                type: string
 *                format: date-time
 *              birthtime:
 *                type: string
 *                format: date-time
 *          innerFileStats:
 *            type: array
 *            items:
 *              type: object
 *              properties:
 *                fileName:
 *                  type: string
 *                collectionName:
 *                  type: string
 *                size:
 *                  type: integer
 *                  nullable: true
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
export default function route(crowi) {
  const { growiBridgeService, socketIoService } = crowi;
  const importService = getImportService(crowi);

  const loginRequired = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const adminEvent = crowi.event('admin');
  const activityEvent = crowi.event('activity');

  // setup event
  adminEvent.on('onProgressForImport', (data) => {
    socketIoService.getAdminSocket().emit('admin:onProgressForImport', data);
  });
  adminEvent.on('onTerminateForImport', (data) => {
    socketIoService.getAdminSocket().emit('admin:onTerminateForImport', data);
  });
  adminEvent.on('onErrorForImport', (data) => {
    socketIoService.getAdminSocket().emit('admin:onErrorForImport', data);
  });

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

  /**
   * @swagger
   *
   *  /import:
   *    get:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /import
   *      description: Get import settings params
   *      responses:
   *        200:
   *          description: import settings params
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  importSettingsParams:
   *                    type: object
   *                    description: import settings params
   *                    properties:
   *                      esaTeamName:
   *                        type: string
   *                        description: the team name of esa.io
   *                      esaAccessToken:
   *                        type: string
   *                        description: the access token of esa.io
   *                      qiitaTeamName:
   *                        type: string
   *                        description: the team name of qiita.com
   *                      qiitaAccessToken:
   *                        type: string
   *                        description: the access token of qiita.com
   */
  router.get('/', accessTokenParser([SCOPE.READ.ADMIN.IMPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired, async(req, res) => {
    try {
      const importSettingsParams = {
        esaTeamName: await crowi.configManager.getConfig('importer:esa:team_name'),
        esaAccessToken: await crowi.configManager.getConfig('importer:esa:access_token'),
        qiitaTeamName: await crowi.configManager.getConfig('importer:qiita:team_name'),
        qiitaAccessToken: await crowi.configManager.getConfig('importer:qiita:access_token'),
      };
      return res.apiv3({
        importSettingsParams,
      });
    }
    catch (err) {
      return res.apiv3Err(err, 500);
    }
  });

  /**
   * @swagger
   *
   *  /import/status:
   *    get:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /import/status
   *      description: Get properties of stored zip files for import
   *      responses:
   *        200:
   *          description: the zip file statuses
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  status:
   *                    $ref: '#/components/schemas/ImportStatus'
   */
  router.get('/status', accessTokenParser([SCOPE.READ.ADMIN.IMPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired, async(req, res) => {
    try {
      const status = await importService.getStatus();
      return res.apiv3(status);
    }
    catch (err) {
      return res.apiv3Err(err, 500);
    }
  });

  /**
   * @swagger
   *
   *  /import:
   *    post:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /import
   *      description: import a collection from a zipped json
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                fileName:
   *                  description: the file name of zip file
   *                  type: string
   *                collections:
   *                  description: collection names to import
   *                  type: array
   *                  items:
   *                    type: string
   *                options:
   *                  description: |
   *                    the array of importing option that have collection name as the key
   *                  additionalProperties:
   *                    type: array
   *                    items:
   *                      $ref: '#/components/schemas/GrowiArchiveImportOption'
   *      responses:
   *        200:
   *          description: Import process has requested
   */
  router.post('/', accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired, addActivity, async(req, res) => {
    // TODO: add express validator
    const { fileName, collections, options } = req.body;

    // pages collection can only be imported by upsert if isV5Compatible is true
    const isV5Compatible = crowi.configManager.getConfig('app:isV5Compatible');
    const isImportPagesCollection = collections.includes('pages');
    if (isV5Compatible && isImportPagesCollection) {
      /** @type {ImportOptionForPages} */
      const option = options.find(opt => opt.collectionName === 'pages');
      if (option.mode !== 'upsert') {
        return res.apiv3Err(new ErrorV3('Upsert is only available for importing pages collection.', 'only_upsert_available'));
      }
    }

    const isMaintenanceMode = crowi.appService.isMaintenanceMode();
    if (!isMaintenanceMode) {
      return res.apiv3Err(new ErrorV3('GROWI is not maintenance mode. To import data, please activate the maintenance mode first.', 'not_maintenance_mode'));
    }


    const zipFile = importService.getFile(fileName);

    // return response first
    res.apiv3();

    /*
     * unzip, parse
     */
    let meta = null;
    let fileStatsToImport = null;
    try {
      // unzip
      await importService.unzip(zipFile);

      // eslint-disable-next-line no-unused-vars
      const { meta: parsedMeta, fileStats, innerFileStats } = await growiBridgeService.parseZipFile(zipFile);
      meta = parsedMeta;

      // filter innerFileStats
      fileStatsToImport = innerFileStats.filter(({ fileName, collectionName, size }) => {
        return collections.includes(collectionName);
      });
    }
    catch (err) {
      logger.error(err);
      adminEvent.emit('onErrorForImport', { message: err.message });
      return;
    }

    /*
     * validate with meta.json
     */
    try {
      importService.validate(meta);
    }
    catch (err) {
      logger.error(err);
      adminEvent.emit('onErrorForImport', { message: err.message });
      return;
    }

    // generate maps of ImportSettings to import
    const importSettingsMap = {};
    fileStatsToImport.forEach(({ fileName, collectionName }) => {
      // instanciate GrowiArchiveImportOption
      /** @type {import('~/models/admin/growi-archive-import-option').GrowiArchiveImportOption} */
      const option = options.find(opt => opt.collectionName === collectionName);

      // generate options
      /** @type {import('~/server/service/import').ImportSettings} */
      const importSettings = {
        mode: option.mode,
        jsonFileName: fileName,
        overwriteParams: generateOverwriteParams(collectionName, req.user._id, option),
      };

      importSettingsMap[collectionName] = importSettings;
    });

    /*
     * import
     */
    try {
      importService.import(collections, importSettingsMap);

      const parameters = { action: SupportedAction.ACTION_ADMIN_GROWI_DATA_IMPORTED };
      activityEvent.emit('update', res.locals.activity._id, parameters);
    }
    catch (err) {
      logger.error(err);
      adminEvent.emit('onErrorForImport', { message: err.message });
    }
  });

  /**
   * @swagger
   *
   *  /import/upload:
   *    post:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /import/upload
   *      description: upload a zip file
   *      requestBody:
   *        content:
   *          multipart/form-data:
   *            schema:
   *              type: object
   *              properties:
   *                file:
   *                  type: string
   *                  format: binary
   *      responses:
   *        200:
   *          description: the file is uploaded
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/FileImportResponse'
   */
  router.post('/upload',
    accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired, uploads.single('file'), addActivity,
    async(req, res) => {
      const { file } = req;
      const zipFile = importService.getFile(file.filename);
      let data = null;

      try {
        data = await growiBridgeService.parseZipFile(zipFile);
      }
      catch (err) {
      // TODO: use ApiV3Error
        logger.error(err);
        return res.status(500).send({ status: 'ERROR' });
      }
      try {
      // validate with meta.json
        importService.validate(data.meta);

        const parameters = { action: SupportedAction.ACTION_ADMIN_ARCHIVE_DATA_UPLOAD };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3(data);
      }
      catch {
        const msg = 'The version of this GROWI and the uploaded GROWI data are not the same';
        const validationErr = 'versions-are-not-met';
        return res.apiv3Err(new ErrorV3(msg, validationErr), 500);
      }
    });

  /**
   * @swagger
   *
   *  /import/all:
   *    delete:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /import/all
   *      description: Delete all zip files
   *      responses:
   *        200:
   *          description: all files are deleted
   */
  router.delete('/all', accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired, async(req, res) => {
    try {
      importService.deleteAllZipFiles();

      return res.apiv3();
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err(err, 500);
    }
  });

  return router;
}
