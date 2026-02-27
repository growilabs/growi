import type { IPage, IUser } from '@growi/core';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import { Comment, CommentEvent, commentEvent } from '~/features/comment/server';

import loggerFactory from '../../utils/logger';
import type Crowi from '../crowi';
import type { PageModel } from '../models/page';

// https://regex101.com/r/Ztxj2j/1
const USERNAME_PATTERN = new RegExp(/\B@[\w@.-]+/g);

const logger = loggerFactory('growi:service:CommentService');

class CommentService {
  crowi!: Crowi;

  activityService!: any;

  inAppNotificationService!: any;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.activityService = crowi.activityService;
    this.inAppNotificationService = crowi.inAppNotificationService;

    // init
    this.initCommentEventListeners();
  }

  initCommentEventListeners(): void {
    // create
    commentEvent.on(CommentEvent.CREATE, async (savedComment) => {
      try {
        const Page = mongoose.model<IPage, PageModel>('Page');
        await Page.updateCommentCount(savedComment.page);
      } catch (err) {
        logger.error(
          'Error occurred while handling the comment create event:\n',
          err,
        );
      }
    });

    // update
    commentEvent.on(CommentEvent.UPDATE, async () => {});

    // remove
    commentEvent.on(CommentEvent.DELETE, async (removedComment) => {
      try {
        const Page = mongoose.model<IPage, PageModel>('Page');
        await Page.updateCommentCount(removedComment.page);
      } catch (err) {
        logger.error('Error occurred while updating the comment count:\n', err);
      }
    });
  }

  getMentionedUsers = async (
    commentId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> => {
    const User = mongoose.model<IUser>('User');

    // Get comment by comment ID
    const commentData = await Comment.findOne({ _id: commentId });

    // not found
    if (commentData == null) {
      logger.warn(`The comment ('${commentId.toString()}') is not found.`);
      return [];
    }

    const { comment } = commentData;

    const usernamesFromComment = comment.match(USERNAME_PATTERN);

    // Get username from comment and remove duplicate username
    const mentionedUsernames = [
      ...new Set(
        usernamesFromComment?.map((username) => {
          return username.slice(1);
        }),
      ),
    ];

    // Get mentioned users ID
    const mentionedUsers = await User.find({
      username: { $in: mentionedUsernames },
    }).select('_id');
    return mentionedUsers.map((user) => {
      return user._id;
    });
  };
}

export default CommentService;
