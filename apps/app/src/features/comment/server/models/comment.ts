import type { IUser } from '@growi/core/dist/interfaces';
import type { Document, Model, Query, Types } from 'mongoose';
import { Schema } from 'mongoose';

import type { IComment } from '~/interfaces/comment';
import { getOrCreateModel } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:models:comment');

export interface CommentDocument extends IComment, Document {
  removeWithReplies: () => Promise<void>;
  findCreatorsByPage: (pageId: Types.ObjectId) => Promise<CommentDocument[]>;
}

type Add = (
  pageId: Types.ObjectId,
  creatorId: Types.ObjectId,
  revisionId: Types.ObjectId,
  comment: string,
  commentPosition: number,
  replyTo?: Types.ObjectId | null,
) => Promise<CommentDocument>;
type FindCommentsByPageId = (
  pageId: Types.ObjectId,
) => Query<CommentDocument[], CommentDocument>;
type FindCommentsByRevisionId = (
  revisionId: Types.ObjectId,
) => Query<CommentDocument[], CommentDocument>;
type FindCreatorsByPage = (pageId: Types.ObjectId) => Promise<IUser[]>;
type CountCommentByPageId = (pageId: Types.ObjectId) => Promise<number>;

export interface CommentModel extends Model<CommentDocument> {
  add: Add;
  findCommentsByPageId: FindCommentsByPageId;
  findCommentsByRevisionId: FindCommentsByRevisionId;
  findCreatorsByPage: FindCreatorsByPage;
  countCommentByPageId: CountCommentByPageId;
}

const commentSchema = new Schema<CommentDocument, CommentModel>(
  {
    page: { type: Schema.Types.ObjectId, ref: 'Page', index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    revision: { type: Schema.Types.ObjectId, ref: 'Revision', index: true },
    comment: { type: String, required: true },
    commentPosition: { type: Number, default: -1 },
    replyTo: { type: Schema.Types.ObjectId },
  },
  {
    timestamps: true,
  },
);

const add: Add = async function (
  this: CommentModel,
  pageId,
  creatorId,
  revisionId,
  comment,
  commentPosition,
  replyTo?,
): Promise<CommentDocument> {
  try {
    const data = await this.create({
      page: pageId.toString(),
      creator: creatorId.toString(),
      revision: revisionId.toString(),
      comment,
      commentPosition,
      replyTo,
    });
    logger.debug('Comment saved.', data);

    return data;
  } catch (err) {
    logger.debug('Error on saving comment.', err);
    throw err;
  }
};
commentSchema.statics.add = add;

commentSchema.statics.findCommentsByPageId = function (id) {
  return this.find({ page: id }).sort({ createdAt: -1 });
};

commentSchema.statics.findCommentsByRevisionId = function (id) {
  return this.find({ revision: id }).sort({ createdAt: -1 });
};

commentSchema.statics.findCreatorsByPage = async function (page) {
  return this.distinct('creator', { page }).exec();
};

commentSchema.statics.countCommentByPageId = async function (page) {
  return this.count({ page });
};

commentSchema.statics.removeWithReplies = async function (comment) {
  await this.deleteMany({
    $or: [{ replyTo: comment._id }, { _id: comment._id }],
  });
};

export const Comment = getOrCreateModel<CommentDocument, CommentModel>(
  'Comment',
  commentSchema,
);
