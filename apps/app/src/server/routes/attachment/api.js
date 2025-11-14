import { SupportedAction } from '~/interfaces/activity';
import { AttachmentType } from '~/server/interfaces/attachment';
import loggerFactory from '~/utils/logger';

import { Attachment } from '../../models/attachment';
import { validateImageContentType } from './image-content-type-validator';

/* eslint-disable no-use-before-define */

const logger = loggerFactory('growi:routes:attachment');

const ApiResponse = require('../../util/apiResponse');

/**
 * @swagger
 *  tags:
 *    name: Attachments
 */

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      Attachment:
 *        description: Attachment
 *        type: object
 *        properties:
 *          _id:
 *            type: string
 *            description: attachment ID
 *            example: 5e0734e072560e001761fa67
 *          __v:
 *            type: number
 *            description: attachment version
 *            example: 0
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
 *            $ref: '#/components/schemas/User'
 *          page:
 *            type: string
 *            description: page ID attached at
 *            example: 5e07345972560e001761fa63
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 *          fileSize:
 *            type: number
 *            description: file size
 *            example: 3494332
 *          url:
 *            type: string
 *            description: attachment URL
 *            example: http://localhost/files/5e0734e072560e001761fa67
 *          filePathProxied:
 *            type: string
 *            description: file path proxied
 *            example: "/attachment/5e0734e072560e001761fa67"
 *          downloadPathProxied:
 *            type: string
 *            description: download path proxied
 *            example: "/download/5e0734e072560e001761fa67"
 */

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      AttachmentProfile:
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
 *          fileFormat:
 *            type: string
 *            description: file format in MIME
 *            example: image/png
 *          fileName:
 *            type: string
 *            description: file name
 *            example: 601b7c59d43a042c0117e08dd37aad0a.png
 *          originalName:
 *            type: string
 *            description: original file name
 *            example: profile.png
 *          creator:
 *            $ref: '#/components/schemas/ObjectId'
 *          page:
 *            type: string
 *            description: page ID attached at
 *            example: null
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
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
 */

/** @param {import('~/server/crowi').default} crowi Crowi instance */
export const routesFactory = (crowi) => {
  const Page = crowi.model('Page');
  const User = crowi.model('User');
  const GlobalNotificationSetting = crowi.model('GlobalNotificationSetting');
  const { attachmentService, globalNotificationService } = crowi;

  const activityEvent = crowi.event('activity');

  /**
   * Check the user is accessible to the related page
   *
   * @param {User} user
   * @param {Attachment} attachment
   */
  async function isDeletableByUser(user, attachment) {
    // deletable if creator is null
    if (attachment.creator == null) {
      return true;
    }

    const ownerId = attachment.creator._id || attachment.creator;
    if (attachment.page == null) {
      // when profile image
      return user.id === ownerId.toString();
    }

    // eslint-disable-next-line no-return-await
    return await Page.isAccessiblePageByViewer(attachment.page, user);
  }

  const actions = {};
  const api = {};

  actions.api = api;

  // api.download = async function(req, res) {
  //   const id = req.params.id;

  //   const attachment = await Attachment.findById(id);

  //   return responseForAttachment(req, res, attachment, true);
  // };

  /**
   * @swagger
   *
   *    /attachments.uploadProfileImage:
   *      post:
   *        tags: [Attachments]
   *        operationId: uploadProfileImage
   *        summary: /attachments.uploadProfileImage
   *        description: Upload profile image
   *        requestBody:
   *          content:
   *            "multipart/form-data":
   *              schema:
   *                properties:
   *                  file:
   *                    type: string
   *                    format: binary
   *                    description: attachment data
   *                  user:
   *                    type: string
   *                    description: user to set profile image
   *              encoding:
   *                path:
   *                  contentType: application/x-www-form-urlencoded
   *            "*\/*":
   *              schema:
   *                properties:
   *                  file:
   *                    type: string
   *                    format: binary
   *                    description: attachment data
   *                  user:
   *                    type: string
   *                    description: user to set profile
   *              encoding:
   *                path:
   *                  contentType: application/x-www-form-urlencoded
   *        responses:
   *          200:
   *            description: Succeeded to add attachment.
   *            content:
   *              application/json:
   *                schema:
   *                  allOf:
   *                    - $ref: '#/components/schemas/ApiResponseSuccess'
   *                    - type: object
   *                      properties:
   *                        attachment:
   *                          $ref: '#/components/schemas/AttachmentProfile'
   *                          description: The uploaded profile image attachment
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {post} /attachments.uploadProfileImage Add attachment for profile image
   * @apiName UploadProfileImage
   * @apiGroup Attachment
   *
   * @apiParam {File} file
   */
  api.uploadProfileImage = async (req, res) => {
    // check params
    if (req.file == null) {
      return res.json(ApiResponse.error('File error.'));
    }
    if (!req.user) {
      return res.json(ApiResponse.error('param "user" must be set.'));
    }

    const file = req.file;

    // Validate file type
    const { isValid, error } = validateImageContentType(file.mimetype);

    if (!isValid) {
      return res.json(ApiResponse.error(error));
    }

    let attachment;
    try {
      const user = await User.findById(req.user._id);
      await user.deleteImage();
      attachment = await attachmentService.createAttachment(
        file,
        req.user,
        null,
        AttachmentType.PROFILE_IMAGE,
      );
      await user.updateImage(attachment);
    } catch (err) {
      logger.error(err);
      return res.json(ApiResponse.error(err.message));
    }

    const result = {
      attachment: attachment.toObject({ virtuals: true }),
    };

    return res.json(ApiResponse.success(result));
  };

  /**
   * @swagger
   *
   *    /attachments.remove:
   *      post:
   *        tags: [Attachments]
   *        operationId: removeAttachment
   *        summary: /attachments.remove
   *        description: Remove attachment
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  attachment_id:
   *                    $ref: '#/components/schemas/ObjectId'
   *                required:
   *                  - attachment_id
   *        responses:
   *          200:
   *            description: Succeeded to remove attachment.
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/ApiResponseSuccess'
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {post} /attachments.remove Remove attachments
   * @apiName RemoveAttachments
   * @apiGroup Attachment
   *
   * @apiParam {String} attachment_id
   */
  api.remove = async (req, res) => {
    const id = req.body.attachment_id;

    const attachment = await Attachment.findById(id);

    if (attachment == null) {
      return res.json(ApiResponse.error('attachment not found'));
    }

    const isDeletable = await isDeletableByUser(req.user, attachment);
    if (!isDeletable) {
      return res.json(
        ApiResponse.error(
          `Forbidden to remove the attachment '${attachment.id}'`,
        ),
      );
    }

    try {
      await attachmentService.removeAttachment(attachment);
    } catch (err) {
      logger.error(err);
      return res
        .status(500)
        .json(ApiResponse.error('Error while deleting file'));
    }

    activityEvent.emit('update', res.locals.activity._id, {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
    });

    return res.json(ApiResponse.success({}));
  };

  /**
   * @swagger
   *
   *    /attachments.removeProfileImage:
   *      post:
   *        tags: [Attachments]
   *        operationId: removeProfileImage
   *        summary: /attachments.removeProfileImage
   *        description: Remove profile image
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  user:
   *                    type: string
   *                    description: user to remove profile image
   *        responses:
   *          200:
   *            description: Succeeded to add attachment.
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/ApiResponseSuccess'
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {post} /attachments.removeProfileImage Remove profile image attachments
   * @apiGroup Attachment
   * @apiParam {String} attachment_id
   */
  api.removeProfileImage = async (req, res) => {
    const user = req.user;
    const attachment = await Attachment.findById(user.imageAttachment);

    if (attachment == null) {
      return res.json(ApiResponse.error('attachment not found'));
    }

    const isDeletable = await isDeletableByUser(user, attachment);
    if (!isDeletable) {
      return res.json(
        ApiResponse.error(
          `Forbidden to remove the attachment '${attachment.id}'`,
        ),
      );
    }

    try {
      await user.deleteImage();
    } catch (err) {
      logger.error(err);
      return res
        .status(500)
        .json(ApiResponse.error('Error while deleting image'));
    }

    return res.json(ApiResponse.success({}));
  };

  return actions;
};
