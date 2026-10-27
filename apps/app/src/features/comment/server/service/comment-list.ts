import { isRevisionOfPage } from '~/server/util/is-revision-of-page';
import type { PrismaClient } from '~/utils/prisma';

import type { CommentListRow } from '../serializers/to-comment-list-item';

export interface ListCommentsInput {
  readonly pageId: string;
  /** Omitted for share-link access. */
  readonly revisionId?: string;
}

export type ListCommentsResult =
  | { readonly kind: 'ok'; readonly comments: readonly CommentListRow[] }
  | { readonly kind: 'revision-not-found' };

type ListCommentsDeps = {
  readonly prisma: Pick<PrismaClient, 'comments' | 'revisions'>;
};

type CreatedBeforeResult =
  | { readonly kind: 'ok'; readonly createdBefore: Date | undefined }
  | { readonly kind: 'revision-not-found' };

/**
 * Resolves the upper bound of comment creation time for `revisionId`: the
 * creation time of the page's oldest revision created after it, or
 * `undefined` when it is the latest revision.
 */
const resolveCreatedBefore = async (
  { prisma }: ListCommentsDeps,
  pageId: string,
  revisionId: string,
): Promise<CreatedBeforeResult> => {
  const revision = await prisma.revisions.findUnique({
    where: { id: revisionId },
    select: { pageId: true, createdAt: true },
  });
  if (!isRevisionOfPage(revision, pageId)) {
    return { kind: 'revision-not-found' };
  }

  const nextRevision = await prisma.revisions.findFirst({
    where: { pageId, createdAt: { gt: revision.createdAt } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  return { kind: 'ok', createdBefore: nextRevision?.createdAt };
};

export const listComments = async (
  deps: ListCommentsDeps,
  input: ListCommentsInput,
): Promise<ListCommentsResult> => {
  const { pageId, revisionId } = input;

  let createdBefore: Date | undefined;
  if (revisionId != null) {
    const bound = await resolveCreatedBefore(deps, pageId, revisionId);
    if (bound.kind === 'revision-not-found') {
      return bound;
    }
    createdBefore = bound.createdBefore;
  }

  const comments = await deps.prisma.comments.findMany({
    where: {
      pageId,
      ...(createdBefore != null && { createdAt: { lt: createdBefore } }),
    },
    include: { creator: true },
    orderBy: { createdAt: 'desc' },
  });
  return { kind: 'ok', comments };
};
