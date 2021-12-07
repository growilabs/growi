import { Types } from 'mongoose';
import { getModelSafely } from '@growi/core';
import loggerFactory from '../../utils/logger';
import ActivityDefine from '../util/activityDefine';
import Crowi from '../crowi';

import { stringifySnapshot } from '~/models/serializers/in-app-notification-snapshot/page';

const logger = loggerFactory('growi:service:CommentService');

class CommentService {

  crowi!: Crowi;

  activityService!: any;

  inAppNotificationService!: any;

  commentEvent!: any;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.activityService = crowi.activityService;
    this.inAppNotificationService = crowi.inAppNotificationService;

    this.commentEvent = crowi.event('comment');

    // init
    this.initCommentEventListeners();
  }

  initCommentEventListeners(): void {
    // create
    this.commentEvent.on('create', async(savedComment) => {

      try {
        const Page = getModelSafely('Page') || require('../models/page')(this.crowi);
        await Page.updateCommentCount(savedComment.page);

        const page = await Page.findById(savedComment.page);
        if (page == null) {
          logger.error('Page is not found');
          return;
        }

        const activity = await this.createActivity(savedComment, ActivityDefine.ACTION_COMMENT_CREATE);
        await this.createAndSendNotifications(activity, page);
      }
      catch (err) {
        logger.error('Error occurred while handling the comment create event:\n', err);
      }

    });

    // update
    this.commentEvent.on('update', async(updatedComment) => {
      try {
        this.commentEvent.onUpdate();
        await this.createActivity(updatedComment, ActivityDefine.ACTION_COMMENT_UPDATE);
      }
      catch (err) {
        logger.error('Error occurred while handling the comment update event:\n', err);
      }
    });

    // remove
    this.commentEvent.on('remove', async(comment) => {
      this.commentEvent.onRemove();

      try {
        const Page = getModelSafely('Page') || require('../models/page')(this.crowi);
        await Page.updateCommentCount(comment.page);
      }
      catch (err) {
        logger.error('Error occurred while updating the comment count:\n', err);
      }
    });
  }

  private createActivity = async function(comment, action) {
    const parameters = {
      user: comment.creator,
      targetModel: ActivityDefine.MODEL_PAGE,
      target: comment.page,
      eventModel: ActivityDefine.MODEL_COMMENT,
      event: comment._id,
      action,
    };
    const activity = await this.activityService.createByParameters(parameters);
    return activity;
  };

  private createAndSendNotifications = async function(activity, page) {
    const snapshot = stringifySnapshot(page);

    // Get user to be notified
    let targetUsers: Types.ObjectId[] = [];
    targetUsers = await activity.getNotificationTargetUsers();

    // Create and send notifications
    await this.inAppNotificationService.upsertByActivity(targetUsers, activity, snapshot);
    await this.inAppNotificationService.emitSocketIo(targetUsers);
  };

}

module.exports = CommentService;
