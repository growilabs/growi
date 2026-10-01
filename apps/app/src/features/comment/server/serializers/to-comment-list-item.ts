import type { Prisma } from '~/generated/prisma/client';
import type { PrismaClient } from '~/utils/prisma';

import type { ICommentCreator, ICommentListItem } from '../../interfaces';

export type CommentListRow = Prisma.Result<
  PrismaClient['comments'],
  { include: { creator: true } },
  'findMany'
>[number];

// serializeUserSecurely() is typed for the mongoose-era IUser, which a Prisma
// user row does not satisfy (nullable `name`); this applies the same omission.
const toCreator = (
  user: NonNullable<CommentListRow['creator']>,
): ICommentCreator => {
  const { password, apiToken, email, ...rest } = user;
  return user.isEmailPublished ? { ...rest, email } : rest;
};

export const toCommentListItem = (row: CommentListRow): ICommentListItem => ({
  ...row,
  _id: row.id,
  page: row.pageId,
  creator: row.creator != null ? toCreator(row.creator) : row.creatorId,
  revision: row.revisionId,
  replyTo: row.replyToId,
});
