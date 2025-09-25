import fs from 'fs';

import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import { param, body } from 'express-validator';
import mongoose from 'mongoose';
import sanitize from 'sanitize-filename';

import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { exportService } from '~/server/service/export';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';


const logger = loggerFactory('growi:routes:apiv3:export');
const router = express.Router();

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      ExportStatus:
 *        type: object
 *        properties:
 *          zipFileStats:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/ExportZipFileStat'
 *          isExporting:
 *            type: boolean
 *          progressList:
 *            type: array
 *            nullable: true
 *            items:
 *              type: string
 *      ExportZipFileStat:
 *        type: object
 *        properties:
 *          meta:
 *            $ref: '#/components/schemas/ExportMeta'
 *          fileName:
 *            type: string
 *          zipFilePath:
 *            type: string
 *          fileStat:
 *            $ref: '#/components/schemas/ExportFileStat'
 *          innerFileStats:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/ExportInnerFileStat'
 *      ExportMeta:
 *        type: object
 *        properties:
 *          version:
 *            type: string
 *          url:
 *            type: string
 *          passwordSeed:
 *            type: string
 *          exportedAt:
 *            type: string
 *            format: date-time
 *          envVars:
 *            type: object
 *            additionalProperties:
 *              type: string
 *      ExportFileStat:
 *        type: object
 *        properties:
 *          dev:
 *            type: integer
 *          mode:
 *            type: integer
 *          nlink:
 *            type: integer
 *          uid:
 *            type: integer
 *          gid:
 *            type: integer
 *          rdev:
 *            type: integer
 *          blksize:
 *            type: integer
 *          ino:
 *            type: integer
 *          size:
 *            type: integer
 *          blocks:
 *            type: integer
 *          atime:
 *            type: string
 *            format: date-time
 *          mtime:
 *            type: string
 *            format: date-time
 *          ctime:
 *            type: string
 *            format: date-time
 *          birthtime:
 *            type: string
 *            format: date-time
 *      ExportInnerFileStat:
 *        type: object
 *        properties:
 *          fileName:
 *            type: string
 *          collectionName:
 *            type: string
 *          meta:
 *            type: object
 *            properties:
 *              progressList:
 *                type: array
 *                items:
 *                  type: object
 *                  description: progress data for each exporting collections
 *              isExporting:
 *                type: boolean
 *                description: whether the current exporting job exists or not
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequired = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const { socketIoService } = crowi;

  const activityEvent = crowi.event('activity');
  const adminEvent = crowi.event('admin');

  // setup event
  adminEvent.on('onProgressForExport', (data) => {
    socketIoService.getAdminSocket().emit('admin:onProgressForExport', data);
  });
  adminEvent.on('onStartZippingForExport', (data) => {
    socketIoService.getAdminSocket().emit('admin:onStartZippingForExport', data);
  });
  adminEvent.on('onTerminateForExport', (data) => {
    socketIoService.getAdminSocket().emit('admin:onTerminateForExport', data);
  });

  const validator = {
    generateZipFile: [
      body('collections')
        .isArray()
        .withMessage('"collections" must be an array')
        .bail()

        .notEmpty()
        .withMessage('"collections" array cannot be empty')
        .bail()

        .custom(async(value) => {
          // Check if all the collections in the request body exist in the database
          const listCollectionsResult = await mongoose.connection.db.listCollections().toArray();
          const allCollectionNames = listCollectionsResult.map(collectionObj => collectionObj.name);
          if (!value.every(v => allCollectionNames.includes(v))) {
            throw new Error('Invalid collections');
          }
        }),
    ],
    deleteFile: [
      // https://regex101.com/r/mD4eZs/6
      // prevent from unexpecting attack doing delete file (path traversal attack)
      param('fileName').not().matches(/(\.\.\/|\.\.\\)/),
    ],
  };


  /**
   * @swagger
   *
   *  /export/status:
   *    get:
   *      tags: [Export]
   *      summary: /export/status
   *      description: get properties of stored zip files for export
   *      responses:
   *        200:
   *          description: the zip file statuses
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  ok:
   *                    type: boolean
   *                    description: whether the request is succeeded or not
   *                  status:
   *                    $ref: '#/components/schemas/ExportStatus'
   */
  router.get('/status', accessTokenParser([SCOPE.READ.ADMIN.EXPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired, async(req, res) => {
    const status = await exportService.getStatus();

    // TODO: use res.apiv3
    return res.json({
      ok: true,
      status,
    });
  });

  /**
   * @swagger
   *
   *  /export:
   *    post:
   *      tags: [Export]
   *      summary: /export
   *      description: generate zipped jsons for collections
   *      requestBody:
   *        content:
   *          application/json:
   *            schema:
   *              properties:
   *                collections:
   *                  type: array
   *                  items:
   *                    type: string
   *                    description: the collections to export
   *                    example: ["pages", "tags"]
   *      responses:
   *        200:
   *          description: a zip file is generated
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  ok:
   *                    type: boolean
   *                    description: whether the request is succeeded
   */
  router.post('/', accessTokenParser([SCOPE.WRITE.ADMIN.EXPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired,
    validator.generateZipFile, apiV3FormValidator, addActivity, async(req, res) => {
    // TODO: add express validator
      try {
        const { collections } = req.body;

        exportService.export(collections);

        const parameters = { action: SupportedAction.ACTION_ADMIN_ARCHIVE_DATA_CREATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        // TODO: use res.apiv3
        return res.status(200).json({
          ok: true,
        });
      }
      catch (err) {
      // TODO: use ApiV3Error
        logger.error(err);
        return res.status(500).send({ status: 'ERROR' });
      }
    });

  /**
   * @swagger
   *
   *  /export/{fileName}:
   *    delete:
   *      tags: [Export]
   *      summary: /export/{fileName}
   *      description: delete the file
   *      parameters:
   *        - name: fileName
   *          in: path
   *          description: the file name of zip file
   *          required: true
   *          schema:
   *            type: string
   *      responses:
   *        200:
   *          description: the file is deleted
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  ok:
   *                    type: boolean
   *                    description: whether the request is succeeded
   */
  router.delete('/:fileName', accessTokenParser([SCOPE.WRITE.ADMIN.EXPORT_DATA], { acceptLegacy: true }), loginRequired, adminRequired,
    validator.deleteFile, apiV3FormValidator, addActivity,
    async(req, res) => {
    // TODO: add express validator
      const { fileName } = req.params;

      try {
        const sanitizedFileName = sanitize(fileName);
        const zipFile = exportService.getFile(sanitizedFileName);
        fs.unlinkSync(zipFile);
        const parameters = { action: SupportedAction.ACTION_ADMIN_ARCHIVE_DATA_DELETE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        // TODO: use res.apiv3
        return res.status(200).send({ ok: true });
      }
      catch (err) {
      // TODO: use ApiV3Error
        logger.error(err);
        return res.status(500).send({ ok: false });
      }
    });

  return router;
};
