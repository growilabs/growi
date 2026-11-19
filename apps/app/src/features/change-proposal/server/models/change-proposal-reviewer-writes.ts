import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';

import type { prisma } from '~/utils/prisma';

import type { ReviewerInput } from '../../interfaces';
import type { ViewerIdentity } from '../domain';
import {
  activeReviewerEntries,
  explainOpenWriteMiss,
  isActiveReviewer,
  isActiveReviewerEntry,
  isRequesterOrReviewer,
  requesterOrReviewerWhere,
  reviewerWhere,
  reviewsClearedByApproval,
  reviewsReplacedBy,
  toReviewCreateInputs,
} from './change-proposal-query-parts';
import type {
  AddReviewersResult,
  RequesterWriteResult,
  ReviewEntry,
} from './change-proposal-types';
import { runConditionalWrite } from './conditional-write';

type Context = Pick<typeof prisma.changeproposals, 'findUnique' | 'updateMany'>;

type ScopedRow = Parameters<typeof isRequesterOrReviewer>[0];

const readScopedRow = (
  context: Context,
  id: string,
): Promise<ScopedRow | null> =>
  context.findUnique({
    where: { id },
    select: { requester: true, lifecycle: true, reviewers: true },
  });

// Raised only after runConditionalWrite gave up and a re-read shows no other reason for the miss.
const writeGaveUp = (id: string): Error =>
  new Error(
    `Change proposal ${id}: the write gave up after repeated write conflicts`,
  );

const NOT_FOUND = { ok: false, code: 'not-found' } as const;

const pushReviewer = (
  context: Context,
  id: string,
  actor: ViewerIdentity,
  input: ReviewerInput,
  now: Date,
): Promise<boolean> =>
  runConditionalWrite(() =>
    context.updateMany({
      where: {
        id,
        lifecycle: 'open',
        ...requesterOrReviewerWhere(actor),
        reviewers: { none: activeReviewerEntries([input]) },
      },
      data: {
        reviewers: {
          push: {
            kind: input.kind,
            id: input.id,
            addedBy: actor.userId,
            addedAt: now,
          },
        },
      },
    }),
  );

export const addReviewers = async (
  context: Context,
  id: string,
  actor: ViewerIdentity,
  inputs: readonly ReviewerInput[],
  now: Date,
): Promise<AddReviewersResult> => {
  if (!isValidObjectId(id) || !isValidObjectId(actor.userId)) {
    return NOT_FOUND;
  }
  const added: ReviewerInput[] = [];
  for (const input of inputs.filter((i) => isValidObjectId(i.id))) {
    // biome-ignore lint/performance/noAwaitInLoops: writes to one document; parallel writes would only conflict
    if (await pushReviewer(context, id, actor, input, now)) {
      added.push(input);
      continue;
    }
    const row = await readScopedRow(context, id);
    const miss = explainOpenWriteMiss(row, (r) =>
      isRequesterOrReviewer(r, actor),
    );
    if (miss != null) {
      return added.length === 0 ? miss : { ok: true, added };
    }
    if (row == null || !isActiveReviewerEntry(row, input)) {
      throw writeGaveUp(id);
    }
  }
  return { ok: true, added };
};

export const removeReviewers = async (
  context: Context,
  id: string,
  actor: ViewerIdentity,
  inputs: readonly ReviewerInput[],
  now: Date,
): Promise<RequesterWriteResult> => {
  if (!isValidObjectId(id) || !isValidObjectId(actor.userId)) {
    return NOT_FOUND;
  }
  const targets = inputs.filter((i) => isValidObjectId(i.id));
  // An empty OR would match every entry, so with no target there is nothing to write.
  const written =
    targets.length > 0 &&
    (await runConditionalWrite(() =>
      context.updateMany({
        where: { id, lifecycle: 'open', ...requesterOrReviewerWhere(actor) },
        data: {
          reviewers: {
            updateMany: {
              where: activeReviewerEntries(targets),
              data: { removedBy: actor.userId, removedAt: now },
            },
          },
        },
      }),
    ));
  if (written) {
    return { ok: true };
  }
  const miss = explainOpenWriteMiss(await readScopedRow(context, id), (r) =>
    isRequesterOrReviewer(r, actor),
  );
  if (miss != null) {
    return miss;
  }
  if (targets.length > 0) {
    throw writeGaveUp(id);
  }
  return { ok: true };
};

export const addReviews = async (
  context: Context,
  id: string,
  reviewer: ViewerIdentity,
  entry: ReviewEntry,
  now: Date,
): Promise<RequesterWriteResult> => {
  if (!isValidObjectId(id) || !isValidObjectId(reviewer.userId)) {
    return NOT_FOUND;
  }
  const pushed = await runConditionalWrite(() =>
    context.updateMany({
      where: { id, lifecycle: 'open', ...reviewerWhere(reviewer) },
      data: {
        reviews: { push: toReviewCreateInputs(reviewer.userId, entry, now) },
      },
    }),
  );
  if (!pushed) {
    const miss = explainOpenWriteMiss(await readScopedRow(context, id), (r) =>
      isActiveReviewer(r, reviewer),
    );
    if (miss == null) {
      throw writeGaveUp(id);
    }
    return miss;
  }
  // Pushed first, so a stop before this delete leaves both records, never neither.
  await runConditionalWrite(() =>
    context.updateMany({
      where: { id },
      data: {
        reviews: {
          deleteMany: { where: reviewsReplacedBy(reviewer.userId, entry, now) },
        },
      },
    }),
  );
  return { ok: true };
};

export const clearReviewsOnApproval = (
  context: Context,
  id: string,
  approverId: string,
  operationKeys: readonly string[],
  wholeProposal: boolean,
): Promise<boolean> => {
  if (!isValidObjectId(id) || !isValidObjectId(approverId)) {
    return Promise.resolve(false);
  }
  return runConditionalWrite(() =>
    context.updateMany({
      where: { id },
      data: {
        reviews: {
          deleteMany: {
            where: reviewsClearedByApproval(
              approverId,
              operationKeys,
              wholeProposal,
            ),
          },
        },
      },
    }),
  );
};
