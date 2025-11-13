import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import express from 'express';
import multer from 'multer';
import autoReap from 'multer-autoreap';

import { SupportedAction } from '~/interfaces/activity';
import { AttachmentType } from '~/server/interfaces/attachment';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { Attachment } from '~/server/models/attachment';
import { serializePageSecurely, serializeRevisionSecurely } from '~/server/models/serializers';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import { certifySharedPageAttachmentMiddleware } from '../../middlewares/certify-shared-page-attachment';
import { excludeReadOnlyUser } from '../../middlewares/exclude-read-only-user';


const logger = loggerFactory('growi:routes:apiv3:attachment'); // eslint-disable-line no-unused-vars

const router = express.Router();
const {
  query, param, body,
} = require('express-validator');


/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      AttachmentPaginateResult:
 *        description: AttachmentPaginateResult
 *        type: object
 *        properties:
 *          docs:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/Attachment'
 *          totalDocs:
 *            type: number
 *            example: 1
 *          limit:
 *            type: number
 *            example: 20
 *          totalPages:
 *            type: number
 *            example: 1
 *          page:
 *            type: number
 *            example: 1
 *          offset:
 *            type: number
 *            example: 0
 *          prevPage:
 *            type: number
 *            example: null
 *          nextPage:
 *            type: number
 *            example: null
 *          hasNextPage:
 *            type: boolean
 *            example: false
 *          hasPrevPage:
 *            type: boolean
 *            example: false
 *          pagingCounter:
 *            type: number
 *            example: 1
 *      Attachment:
 *        description: Attachment
 *        type: object
 *        properties:
 *          id:
 *            type: string
 *            description: attachment ID
 *            example: 5e0734e072560e001761fa67
 *          _id:
 *            type: string
 *            description: attachment ID
 *            example: 5e0734e072560e001761fa67
 *          __v:
 *            type: number
 *            description: attachment version
 *            example: 0
 *          attachmentType:
 *            type: string
 *            description: attachment type
 *            example: WIKI_PAGE
 *          fileFormat:
 *            type: string
 *            description: file format in MIME
 *            example: text/plain
 *          fileName:
 *            type: string
 *            description: file name
 *            example: 601b7c59d43a042c0117e08dd37aad0aimage.txt
 *          originalName:
 *            type: string
 *            description: original file name
 *            example: file.txt
 *          creator:
 *            type: object
 *            $ref: '#/components/schemas/User'
 *          page:
 *            type: string
 *            description: page ID attached at
 *            example: 5e07345972560e001761fa63
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 *          temporaryUrlExpiredAt:
 *            type: string
 *            description: temporary URL expired at
 *            example: 2024-11-27T00:59:59.962Z
 *          fileSize:
 *            type: number
 *            description: file size
 *            example: 3494332
 *          filePathProxied:
 *            type: string
 *            description: file path proxied
 *            example: "/attachment/5e0734e072560e001761fa67"
 *          downloadPathProxied:
 *            type: string
 *            description: download path proxied
 *            example: "/download/5e0734e072560e001761fa67"
 *          temporaryUrlCached:
 *            type: string
 *            description: temporary URL cached
 *            example: "https://example.com/attachment/5e0734e072560e001761fa67"
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequired = require('../../middlewares/login-required')(crowi, true);
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);
  const Page = crowi.model('Page');
  const User = crowi.model('User');
  const { attachmentService } = crowi;
  const uploads = multer({ dest: `${crowi.tmpDir}uploads` });
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  const validator = {
    retrieveAttachment: [
      param('id').isMongoId().withMessage('attachment id is required'),
    ],
    retrieveAttachments: [
      query('pageId').isMongoId().withMessage('pageId is required'),
      query('pageNumber').optional().isInt().withMessage('pageNumber must be a number'),
      query('limit').optional().isInt({ max: 100 }).withMessage('You should set less than 100 or not to set limit.'),
    ],
    retrieveFileLimit: [
      query('fileSize').isNumeric().exists({ checkNull: true }).withMessage('fileSize is required'),
    ],
    retrieveAddAttachment: [
      body('page_id').isMongoId().exists({ checkNull: true }).withMessage('page_id is required'),
    ],
  };

  /**
   * @swagger
   *
   *    /attachment/list:
   *      get:
   *        tags: [Attachment]
   *        description: Get attachment list
   *        parameters:
   *          - name: pageId
   *            in: query
   *            required: true
   *            description: page id
   *            schema:
   *              type: string
   *          - name: pageNumber
   *            in: query
   *            required: false
   *            description: page number
   *            schema:
   *              type: number
   *              example: 1
   *          - name: limit
   *            in: query
   *            required: false
   *            description: limit
   *            schema:
   *              type: number
   *              example: 10
   *        responses:
   *          200:
   *            description: Return attachment list
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  $ref: '#/components/schemas/AttachmentPaginateResult'
   */
  router.get('/list',
    accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT], { acceptLegacy: true }), loginRequired, validator.retrieveAttachments, apiV3FormValidator,
    async(req, res) => {

      const limit = req.query.limit || await crowi.configManager.getConfig('customize:showPageLimitationS') || 10;
      const pageNumber = req.query.pageNumber || 1;
      const offset = (pageNumber - 1) * limit;

      try {
        const pageId = req.query.pageId;
        // check whether accessible
        const isAccessible = await Page.isAccessiblePageByViewer(pageId, req.user);
        if (!isAccessible) {
          const msg = 'Current user is not accessible to this page.';
          return res.apiv3Err(new ErrorV3(msg, 'attachment-list-failed'), 403);
        }

        // directly get paging-size from db. not to delivery from client side.

        const paginateResult = await Attachment.paginate(
          { page: pageId },
          {
            limit,
            offset,
            populate: 'creator',
          },
        );

        paginateResult.docs.forEach((doc) => {
          if (doc.creator != null && doc.creator instanceof User) {
            doc.creator = serializeUserSecurely(doc.creator);
          }
        });

        return res.apiv3({ paginateResult });
      }
      catch (err) {
        logger.error('Attachment not found', err);
        return res.apiv3Err(err, 500);
      }
    });


  /**
   * @swagger
   *
   *    /attachment/limit:
   *      get:
   *        tags: [Attachment]
   *        summary: /attachment/limit
   *        description: Get available capacity of uploaded file with GridFS
   *        parameters:
   *          - in: query
   *            name: fileSize
   *            schema:
   *              type: number
   *              description: file size
   *              example: 23175
   *            required: true
   *        responses:
   *          200:
   *            description: Succeeded to get available capacity of uploaded file with GridFS.
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    isUploadable:
   *                      type: boolean
   *                      description: uploadable
   *                      example: true
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  router.get('/limit',
    accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT], { acceptLegacy: true }), loginRequiredStrictly, validator.retrieveFileLimit, apiV3FormValidator,
    async(req, res) => {
      const { fileUploadService } = crowi;
      const fileSize = Number(req.query.fileSize);
      try {
        return res.apiv3(await fileUploadService.checkLimit(fileSize));
      }
      catch (err) {
        logger.error('File limit retrieval failed', err);
        return res.apiv3Err(err, 500);
      }
    });

  /**
   * @swagger
   *
   *    /attachment:
   *      post:
   *        tags: [Attachment]
   *        summary: /attachment
   *        description: Add attachment to the page
   *        requestBody:
   *          content:
   *            "multipart/form-data":
   *              schema:
   *                properties:
   *                  page_id:
   *                    nullable: false
   *                    type: string
   *                  file:
   *                    type: string
   *                    format: binary
   *                    description: attachment data
   *              encoding:
   *                path:
   *                  contentType: application/x-www-form-urlencoded
   *            "*\/*":
   *              schema:
   *                properties:
   *                  page_id:
   *                    nullable: false
   *                    type: string
   *                  file:
   *                    type: string
   *                    format: binary
   *                    description: attachment data
   *              encoding:
   *                path:
   *                  contentType: application/x-www-form-urlencoded
   *        responses:
   *          200:
   *            description: Succeeded to add attachment.
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    page:
   *                      $ref: '#/components/schemas/Page'
   *                    attachment:
   *                      $ref: '#/components/schemas/Attachment'
   *                    revision:
   *                      type: string
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  router.post('/', uploads.single('file'), accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT], { acceptLegacy: true }),
    loginRequiredStrictly, excludeReadOnlyUser, validator.retrieveAddAttachment, apiV3FormValidator, addActivity,
    // Removed autoReap middleware to use file data in asynchronous processes. Instead, implemented file deletion after asynchronous processes complete
    async(req, res) => {

      const pageId = req.body.page_id;

      // check params
      const file = req.file || null;
      if (file == null) {
        return res.apiv3Err('File error.');
      }

      try {
        const page = await Page.findOne({ _id: { $eq: pageId } });

        // check the user is accessible
        const isAccessible = await Page.isAccessiblePageByViewer(page.id, req.user);
        if (!isAccessible) {
          return res.apiv3Err(`Forbidden to access to the page '${page.id}'`);
        }

        const attachment = await attachmentService.createAttachment(file, req.user, pageId, AttachmentType.WIKI_PAGE, () => autoReap(req, res, () => {}));

        const result = {
          page: serializePageSecurely(page),
          revision: serializeRevisionSecurely(page.revision),
          attachment: attachment.toObject({ virtuals: true }),
        };

        activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ATTACHMENT_ADD });

        res.apiv3(result);
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(err.message);
      }
    });

  /**
   * @swagger
   *
   *    /attachment/{id}:
   *      get:
   *        tags: [Attachment]
   *        description: Get attachment
   *        responses:
   *          200:
   *            description: Return attachment
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    attachment:
   *                      $ref: '#/components/schemas/Attachment'
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: attachment id
   *            schema:
   *              type: string
   */
  router.get('/:id', accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT], { acceptLegacy: true }), certifySharedPageAttachmentMiddleware, loginRequired,
    validator.retrieveAttachment, apiV3FormValidator,
    async(req, res) => {
      try {
        const attachmentId = req.params.id;

        const attachment = await Attachment.findById(attachmentId).populate('creator').exec();

        if (attachment == null) {
          const message = 'Attachment not found';
          return res.apiv3Err(message, 404);
        }

        if (attachment.creator != null && attachment.creator instanceof User) {
          attachment.creator = serializeUserSecurely(attachment.creator);
        }

        return res.apiv3({ attachment });
      }
      catch (err) {
        logger.error('Attachment retrieval failed', err);
        return res.apiv3Err(err, 500);
      }
    });

  return router;
};
