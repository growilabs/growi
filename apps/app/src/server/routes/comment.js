import { getIdStringForRef } from '@growi/core';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';

import { Comment, CommentEvent, commentEvent } from '~/features/comment/server';
import {
  SupportedAction,
  SupportedEventModel,
  SupportedTargetModel,
} from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';

import { GlobalNotificationSettingEvent } from '../models/GlobalNotificationSetting';
import { preNotifyService } from '../service/pre-notify';

/**
 * @swagger
 *  tags:
 *    name: Comments
 */

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      CommentBody:
 *        description: The type for Comment.comment
 *        type: string
 *        example: good
 *      CommentPosition:
 *        description: comment position
 *        type: number
 *        example: 0
 *      Comment:
 *        description: Comment
 *        type: object
 *        properties:
 *          _id:
 *            $ref: '#/components/schemas/ObjectId'
 *          __v:
 *            type: number
 *            description: DB record version
 *            example: 0
 *          page:
 *            $ref: '#/components/schemas/ObjectId'
 *          creator:
 *            $ref: '#/components/schemas/ObjectId'
 *          revision:
 *            $ref: '#/components/schemas/ObjectId'
 *          comment:
 *            $ref: '#/components/schemas/CommentBody'
 *          commentPosition:
 *            $ref: '#/components/schemas/CommentPosition'
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 */

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi, app) => {
  const logger = loggerFactory('growi:routes:comment');
  const User = crowi.model('User');
  const Page = crowi.model('Page');
  const ApiResponse = require('../util/apiResponse');

  const activityEvent = crowi.event('activity');

  const globalNotificationService = crowi.getGlobalNotificationService();
  const userNotificationService = crowi.getUserNotificationService();

  const { body } = require('express-validator');
  const mongoose = require('mongoose');
  const ObjectId = mongoose.Types.ObjectId;

  const actions = {};
  const api = {};

  actions.api = api;
  api.validators = {};

  /**
   * @swagger
   *
   *    /comments.get:
   *      get:
   *        tags: [Comments]
   *        operationId: getComments
   *        summary: /comments.get
   *        description: Get comments of the page of the revision
   *        parameters:
   *          - in: query
   *            name: page_id
   *            schema:
   *              $ref: '#/components/schemas/ObjectId'
   *          - in: query
   *            name: revision_id
   *            schema:
   *              $ref: '#/components/schemas/ObjectId'
   *        responses:
   *          200:
   *            description: Succeeded to get comments of the page of the revision.
   *            content:
   *              application/json:
   *                schema:
   *                  allOf:
   *                    - $ref: '#/components/schemas/ApiResponseSuccess'
   *                    - type: object
   *                      properties:
   *                        comments:
   *                          type: array
   *                          items:
   *                            $ref: '#/components/schemas/Comment'
   *                          description: List of comments for the page revision
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {get} /comments.get Get comments of the page of the revision
   * @apiName GetComments
   * @apiGroup Comment
   *
   * @apiParam {String} page_id Page Id.
   * @apiParam {String} revision_id Revision Id.
   */
  api.get = async (req, res) => {
    const pageId = req.query.page_id;
    const revisionId = req.query.revision_id;

    // check whether accessible
    const isAccessible = await Page.isAccessiblePageByViewer(pageId, req.user);
    if (!isAccessible) {
      return res.json(
        ApiResponse.error('Current user is not accessible to this page.'),
      );
    }

    let query = null;

    try {
      if (revisionId) {
        query = Comment.findCommentsByRevisionId(revisionId);
      } else {
        query = Comment.findCommentsByPageId(pageId);
      }
    } catch (err) {
      return res.json(ApiResponse.error(err));
    }

    const comments = await query.populate('creator');
    comments.forEach((comment) => {
      if (comment.creator != null && comment.creator instanceof User) {
        comment.creator = serializeUserSecurely(comment.creator);
      }
    });

    res.json(ApiResponse.success({ comments }));
  };

  api.validators.add = () => {
    const validator = [
      body('commentForm.page_id').exists(),
      body('commentForm.revision_id').exists(),
      body('commentForm.comment').exists(),
      body('commentForm.comment_position').isInt(),
      body('commentForm.is_markdown').isBoolean(),
      body('commentForm.replyTo')
        .exists()
        .custom((value) => {
          if (value === '') {
            return undefined;
          }
          return ObjectId(value);
        }),

      body('slackNotificationForm.isSlackEnabled').isBoolean().exists(),
    ];
    return validator;
  };

  /**
   * @swagger
   *
   *    /comments.add:
   *      post:
   *        tags: [Comments]
   *        operationId: addComment
   *        summary: /comments.add
   *        description: Post comment for the page
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  commentForm:
   *                    type: object
   *                    properties:
   *                      page_id:
   *                        $ref: '#/components/schemas/ObjectId'
   *                      revision_id:
   *                        $ref: '#/components/schemas/ObjectId'
   *                      comment:
   *                        $ref: '#/components/schemas/CommentBody'
   *                      comment_position:
   *                        $ref: '#/components/schemas/CommentPosition'
   *                required:
   *                  - commentForm
   *        responses:
   *          200:
   *            description: Succeeded to post comment for the page.
   *            content:
   *              application/json:
   *                schema:
   *                  allOf:
   *                    - $ref: '#/components/schemas/ApiResponseSuccess'
   *                    - type: object
   *                      properties:
   *                        comment:
   *                          $ref: '#/components/schemas/Comment'
   *                          description: The newly created comment
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {post} /comments.add Post comment for the page
   * @apiName PostComment
   * @apiGroup Comment
   *
   * @apiParam {String} page_id Page Id.
   * @apiParam {String} revision_id Revision Id.
   * @apiParam {String} comment Comment body
   * @apiParam {Number} comment_position=-1 Line number of the comment
   */
  api.add = async (req, res) => {
    const { commentForm, slackNotificationForm } = req.body;
    const { validationResult } = require('express-validator');

    const errors = validationResult(req.body);
    if (!errors.isEmpty()) {
      return res.json(ApiResponse.error('コメントを入力してください。'));
    }

    const pageId = commentForm.page_id;
    const revisionId = commentForm.revision_id;
    const comment = commentForm.comment;
    const position = commentForm.comment_position || -1;
    const replyTo = commentForm.replyTo;

    // check whether accessible
    const isAccessible = await Page.isAccessiblePageByViewer(pageId, req.user);
    if (!isAccessible) {
      return res.json(
        ApiResponse.error('Current user is not accessible to this page.'),
      );
    }

    if (comment === '') {
      return res.json(ApiResponse.error('Comment text is required'));
    }

    let createdComment;
    try {
      createdComment = await Comment.add(
        pageId,
        req.user._id,
        revisionId,
        comment,
        position,
        replyTo,
      );
      commentEvent.emit(CommentEvent.CREATE, createdComment);
    } catch (err) {
      logger.error(err);
      return res.json(ApiResponse.error(err));
    }
    // update page
    const page = await Page.findOneAndUpdate(
      { _id: pageId },
      {
        lastUpdateUser: req.user,
        updatedAt: new Date(),
      },
    );

    const parameters = {
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: page,
      eventModel: SupportedEventModel.MODEL_COMMENT,
      event: createdComment,
      action: SupportedAction.ACTION_COMMENT_CREATE,
    };

    /** @type {import('../service/pre-notify').GetAdditionalTargetUsers} */
    const getAdditionalTargetUsers = async (activity) => {
      const mentionedUsers = await crowi.commentService.getMentionedUsers(
        activity.event,
      );

      return mentionedUsers;
    };

    activityEvent.emit(
      'update',
      res.locals.activity._id,
      parameters,
      page,
      preNotifyService.generatePreNotify,
      getAdditionalTargetUsers,
    );

    res.json(ApiResponse.success({ comment: createdComment }));

    // global notification
    try {
      await globalNotificationService.fire(
        GlobalNotificationSettingEvent.COMMENT,
        page,
        req.user,
        {
          comment: createdComment,
        },
      );
    } catch (err) {
      logger.error('Comment notification　failed', err);
    }

    // slack notification
    if (slackNotificationForm.isSlackEnabled) {
      const { slackChannels } = slackNotificationForm;

      try {
        const results = await userNotificationService.fire(
          page,
          req.user,
          slackChannels,
          'comment',
          {},
          createdComment,
        );
        results.forEach((result) => {
          if (result.status === 'rejected') {
            logger.error('Create user notification failed', result.reason);
          }
        });
      } catch (err) {
        logger.error('Create user notification failed', err);
      }
    }
  };

  /**
   * @swagger
   *
   *    /comments.update:
   *      post:
   *        tags: [Comments]
   *        operationId: updateComment
   *        summary: /comments.update
   *        description: Update comment dody
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  form:
   *                    type: object
   *                    properties:
   *                      commentForm:
   *                        type: object
   *                        properties:
   *                          page_id:
   *                            $ref: '#/components/schemas/ObjectId'
   *                          revision_id:
   *                            $ref: '#/components/schemas/ObjectId'
   *                          comment_id:
   *                            $ref: '#/components/schemas/ObjectId'
   *                          comment:
   *                            $ref: '#/components/schemas/CommentBody'
   *                required:
   *                  - form
   *        responses:
   *          200:
   *            description: Succeeded to update comment dody.
   *            content:
   *              application/json:
   *                schema:
   *                  allOf:
   *                    - $ref: '#/components/schemas/ApiResponseSuccess'
   *                    - type: object
   *                      properties:
   *                        comment:
   *                          $ref: '#/components/schemas/Comment'
   *                          description: The updated comment
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {post} /comments.update Update comment dody
   * @apiName UpdateComment
   * @apiGroup Comment
   */
  api.update = async (req, res) => {
    const { commentForm } = req.body;

    const commentStr = commentForm?.comment;
    const commentId = commentForm?.comment_id;
    const revision = commentForm?.revision_id;

    if (commentStr === '') {
      return res.json(ApiResponse.error('Comment text is required'));
    }

    if (commentId == null) {
      return res.json(ApiResponse.error("'comment_id' is undefined"));
    }

    let updatedComment;
    try {
      const comment = await Comment.findById(commentId).exec();

      if (comment == null) {
        throw new Error('This comment does not exist.');
      }

      // check whether accessible
      const pageId = comment.page;
      const isAccessible = await Page.isAccessiblePageByViewer(
        pageId,
        req.user,
      );
      if (!isAccessible) {
        throw new Error('Current user is not accessible to this page.');
      }
      if (req.user._id.toString() !== comment.creator.toString()) {
        throw new Error('Current user is not operatable to this comment.');
      }

      updatedComment = await Comment.findOneAndUpdate(
        { _id: commentId },
        { $set: { comment: commentStr, revision } },
      );
      commentEvent.emit(CommentEvent.UPDATE, updatedComment);
    } catch (err) {
      logger.error(err);
      return res.json(ApiResponse.error(err));
    }

    const parameters = { action: SupportedAction.ACTION_COMMENT_UPDATE };
    activityEvent.emit('update', res.locals.activity._id, parameters);

    res.json(ApiResponse.success({ comment: updatedComment }));

    // process notification if needed
  };

  /**
   * @swagger
   *
   *    /comments.remove:
   *      post:
   *        tags: [Comments]
   *        operationId: removeComment
   *        summary: /comments.remove
   *        description: Remove specified comment
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  comment_id:
   *                    $ref: '#/components/schemas/ObjectId'
   *                required:
   *                  - comment_id
   *        responses:
   *          200:
   *            description: Succeeded to remove specified comment.
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
   * @api {post} /comments.remove Remove specified comment
   * @apiName RemoveComment
   * @apiGroup Comment
   *
   * @apiParam {String} comment_id Comment Id.
   */
  api.remove = async (req, res) => {
    const commentId = req.body.comment_id;
    if (!commentId) {
      return Promise.resolve(
        res.json(ApiResponse.error("'comment_id' is undefined")),
      );
    }

    try {
      /** @type {import('mongoose').HydratedDocument<import('~/interfaces/comment').IComment>} */
      const comment = await Comment.findById(commentId).exec();

      if (comment == null) {
        throw new Error('This comment does not exist.');
      }

      // check whether accessible
      const pageId = getIdStringForRef(comment.page);
      const isAccessible = await Page.isAccessiblePageByViewer(
        pageId,
        req.user,
      );
      if (!isAccessible) {
        throw new Error('Current user is not accessible to this page.');
      }
      if (getIdStringForRef(req.user) !== getIdStringForRef(comment.creator)) {
        throw new Error('Current user is not operatable to this comment.');
      }

      await Comment.removeWithReplies(comment);
      await Page.updateCommentCount(comment.page);
      commentEvent.emit(CommentEvent.DELETE, comment);
    } catch (err) {
      return res.json(ApiResponse.error(err));
    }

    const parameters = { action: SupportedAction.ACTION_COMMENT_REMOVE };
    activityEvent.emit('update', res.locals.activity._id, parameters);

    return res.json(ApiResponse.success({}));
  };

  return actions;
};
