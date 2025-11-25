import type { Types } from 'mongoose';

import { Comment, CommentEvent, commentEvent } from '~/features/comment/server';
import pageModelFactory from '~/server/models/page';

import loggerFactory from '../../utils/logger';
import type Crowi from '../crowi';
import userModelFactory from '../models/user';

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
        const Page = pageModelFactory(this.crowi);
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
        const Page = pageModelFactory(this.crowi);
        await Page.updateCommentCount(removedComment.page);
      } catch (err) {
        logger.error('Error occurred while updating the comment count:\n', err);
      }
    });
  }

  getMentionedUsers = async (
    commentId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> => {
    const User = userModelFactory(this.crowi);

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
    const mentionedUserIDs = await User.find({
      username: { $in: mentionedUsernames },
    });
    return mentionedUserIDs?.map((user) => {
      return user._id;
    });
  };
}

module.exports = CommentService;
