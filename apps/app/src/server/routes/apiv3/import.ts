import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Router } from 'express';

import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
// The same code both import entry points answer a busy import with; the receive route's
// caller matches on the exact string, so it is declared once.
import { G2G_IMPORT_IN_PROGRESS_ERROR_CODE } from '~/server/models/vo/g2g-transfer-error';
import { pendingActivityContext } from '~/server/service/activity/index';
import type { ImportSettings } from '~/server/service/import';
import { getImportService } from '~/server/service/import';
import type { ZipFileStat } from '~/server/service/interfaces/export';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { executeImport } from './import-executor';
import { buildImportSettingsMap } from './import-settings-builder';
import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:import');

import express from 'express';
import multer from 'multer';
import path from 'path';

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
export default function route(crowi: Crowi): Router {
  const { growiBridgeService, socketIoService } = crowi;
  const importService = getImportService();

  const loginRequired = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();

  const adminEvent = crowi.events.admin;
  const activityEvent = crowi.events.activity;

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
   *  /import/status:
   *    get:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
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
  router.get(
    '/status',
    accessTokenParser([SCOPE.READ.ADMIN.IMPORT_DATA], { acceptLegacy: true }),
    loginRequired,
    adminRequired,
    async (req: CrowiRequest, res: ApiV3Response) => {
      try {
        const status = await importService.getStatus();
        return res.apiv3(status);
      } catch (err) {
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   *  /import:
   *    post:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
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
  router.post(
    '/',
    accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA], { acceptLegacy: true }),
    loginRequired,
    adminRequired,
    addActivity,
    async (req: CrowiRequest, res: ApiV3Response) => {
      // TODO: add express validator
      const { fileName, collections, options } = req.body;

      // loginRequired + adminRequired guarantee req.user at runtime; guard narrows the type
      const { user } = req;
      if (user == null) {
        return res.apiv3Err(
          new ErrorV3('param "user" must be set.', 'forbidden'),
          403,
        );
      }

      // pages collection can only be imported by upsert if isV5Compatible is true
      const isV5Compatible =
        crowi.configManager.getConfig('app:isV5Compatible');
      const isImportPagesCollection = collections.includes('pages');
      if (isV5Compatible && isImportPagesCollection) {
        /** @type {ImportOptionForPages} */
        const option = options.find((opt) => opt.collectionName === 'pages');
        if (option.mode !== 'upsert') {
          return res.apiv3Err(
            new ErrorV3(
              'Upsert is only available for importing pages collection.',
              'only_upsert_available',
            ),
          );
        }
      }

      const isMaintenanceMode = crowi.appService.isMaintenanceMode();
      if (!isMaintenanceMode) {
        return res.apiv3Err(
          new ErrorV3(
            'GROWI is not maintenance mode. To import data, please activate the maintenance mode first.',
            'not_maintenance_mode',
          ),
        );
      }

      const zipFile = importService.getFile(fileName);

      // Capture the activity context BEFORE responding. The import runs after
      // this response and registerFailsafeFinalizer clears this request's
      // pending context on the response's 'finish' event, so the post-import
      // activity emit would otherwise settle with user=null (see PR #11510 and
      // ExecuteImportArgs.activityContext).
      //
      // Optional on purpose: `add-activity` catches its own failures and calls `next()`
      // without setting `res.locals.activity`, so reading `._id` outright can throw. That
      // read used to sit between the claim below and the `try` that releases it, where a
      // throw — which Express 4 does not catch for an async handler — would have left the
      // claim held for the life of the process and every later import, admin and G2G
      // alike, refused with a 409. Losing the audit row is the lesser harm; losing the
      // import is not.
      const activityId: string | undefined = res.locals.activity?._id;
      const activityContext =
        activityId != null
          ? pendingActivityContext.take(activityId)
          : undefined;

      // Claimed before the response, because everything below runs after it has been sent:
      // without the claim, a second import could start writing while this one is still
      // reading the same directory.
      //
      // The maintenance-mode check above is no substitute. It only asks whether the wiki
      // is closed to ordinary users, which says nothing about whether an import is already
      // under way — and being closed is the normal state around one, since importing
      // `configs` leaves maintenance mode on afterwards. So that gate waves a second zip
      // straight through into the middle of the first import, or of a G2G transfer writing
      // to the same place.
      //
      // Claimed last, immediately before the `try`: everything above can still leave
      // without reaching the `finally` that releases it, and nothing may be added in
      // between.
      const importJob = importService.acquireImportJob();
      if (importJob == null) {
        return res.apiv3Err(
          new ErrorV3(
            'Another import is already running on this GROWI.',
            G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
          ),
          409,
        );
      }

      // `try/finally` rather than a response event: this route answers before it starts
      // working, so releasing on the response would hand the job away while the import is
      // still running. The response is sent inside the `try` so that nothing at all sits
      // between the claim and the `finally` that returns it.
      try {
        // return response first
        res.apiv3();

        /*
         * unzip, parse
         */
        let meta: object;
        let fileStatsToImport: {
          fileName: string;
          collectionName: string;
          size: number;
        }[];
        try {
          // unzip
          await importService.unzip(zipFile);

          const parseZipResult = await growiBridgeService.parseZipFile(zipFile);
          if (parseZipResult == null) {
            throw new Error('parseZipFile returns null');
          }

          meta = parseZipResult.meta;

          // filter innerFileStats
          fileStatsToImport = parseZipResult.innerFileStats.filter(
            ({ collectionName }) => {
              return collections.includes(collectionName);
            },
          );
        } catch (err) {
          logger.error(err);
          adminEvent.emit('onErrorForImport', { message: err.message });
          return;
        }

        /*
         * validate with meta.json
         */
        try {
          importService.validate(meta);
        } catch (err) {
          logger.error(err);
          adminEvent.emit('onErrorForImport', { message: err.message });
          return;
        }

        // generate maps of ImportSettings to import
        let importSettingsMap: Map<string, ImportSettings>;
        try {
          importSettingsMap = buildImportSettingsMap(
            fileStatsToImport,
            options,
            user._id.toString(),
          );
        } catch (err) {
          logger.error(err);
          adminEvent.emit('onErrorForImport', { message: err.message });
          return;
        }

        /*
         * import
         */
        await executeImport({
          importService,
          adminEvent,
          activityEvent,
          activityId,
          activityContext,
          collections,
          importSettingsMap,
        });
      } finally {
        importJob.release();
      }
    },
  );

  /**
   * @swagger
   *
   *  /import/upload:
   *    post:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
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
  router.post(
    '/upload',
    accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA], { acceptLegacy: true }),
    loginRequired,
    adminRequired,
    uploads.single('file'),
    addActivity,
    async (req: CrowiRequest, res: ApiV3Response) => {
      const { file } = req;
      // uploads.single('file') populates req.file; guard narrows the type
      if (file == null) {
        return res.apiv3Err(new ErrorV3('File error.', 'file_not_found'), 400);
      }
      const zipFile = importService.getFile(file.filename);
      let data: ZipFileStat | null;

      try {
        data = await growiBridgeService.parseZipFile(zipFile);
      } catch (err) {
        // TODO: use ApiV3Error
        logger.error(err);
        return res.status(500).send({ status: 'ERROR' });
      }
      try {
        // validate with meta.json
        importService.validate(data?.meta);

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_ARCHIVE_DATA_UPLOAD,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3(data);
      } catch {
        const msg =
          'The version of this GROWI and the uploaded GROWI data are not the same';
        const validationErr = 'versions-are-not-met';
        return res.apiv3Err(new ErrorV3(msg, validationErr), 500);
      }
    },
  );

  /**
   * @swagger
   *
   *  /import/all:
   *    delete:
   *      tags: [Import]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
   *      summary: /import/all
   *      description: Delete all zip files
   *      responses:
   *        200:
   *          description: all files are deleted
   */
  router.delete(
    '/all',
    accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA], { acceptLegacy: true }),
    loginRequired,
    adminRequired,
    async (req: CrowiRequest, res: ApiV3Response) => {
      try {
        importService.deleteAllZipFiles();

        return res.apiv3();
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  return router;
}
