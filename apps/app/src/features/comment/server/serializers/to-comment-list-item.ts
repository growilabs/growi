import type { Prisma } from '~/generated/prisma/client';
import type { PrismaClient } from '~/utils/prisma';

import type {
  ICommentCreatorSummary,
  ICommentListItem,
} from '../../interfaces';

export type CommentListRow = Prisma.Result<
  PrismaClient['comments'],
  { include: { creator: true } },
  'findMany'
>[number];

type CreatorRow = NonNullable<CommentListRow['creator']>;

/** A user row without credentials; `email` only when the user publishes it. */
type LegacyCommentCreator = Omit<
  CreatorRow,
  'password' | 'apiToken' | 'email'
> & { email?: string | null };

type CommentListItemWith<TCreator> = Omit<ICommentListItem, 'creator'> & {
  creator: TCreator | string | null;
};

const toCreatorSummary = ({
  _id,
  username,
  name,
  imageUrlCached,
}: CreatorRow): ICommentCreatorSummary => ({
  _id,
  username,
  name,
  imageUrlCached,
});

// serializeUserSecurely() is typed for the mongoose-era IUser, which a Prisma
// user row does not satisfy (nullable `name`); this applies the same omission.
const toLegacyCreator = (user: CreatorRow): LegacyCommentCreator => {
  const { password, apiToken, email, ...rest } = user;
  return user.isEmailPublished ? { ...rest, email } : rest;
};

const createCommentListItemMapper =
  <TCreator>(formatCreator: (user: CreatorRow) => TCreator) =>
  (row: CommentListRow): CommentListItemWith<TCreator> => ({
    ...row,
    _id: row.id,
    page: row.pageId,
    creator: row.creator != null ? formatCreator(row.creator) : row.creatorId,
    revision: row.revisionId,
    replyTo: row.replyToId,
  });

/** For `GET /_api/v3/comments`. */
export const toCommentListItem: (row: CommentListRow) => ICommentListItem =
  createCommentListItemMapper(toCreatorSummary);

/** For the deprecated `GET /_api/comments.get`, whose output must not change. */
export const toLegacyCommentListItem: (
  row: CommentListRow,
) => CommentListItemWith<LegacyCommentCreator> =
  createCommentListItemMapper(toLegacyCreator);
