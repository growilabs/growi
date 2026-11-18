import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';

import { prisma } from '~/utils/prisma';

import type {
  ReviewerInput,
  ReviewerKind,
  ReviewerRef,
} from '../../interfaces';
import { activeReviewers, hasForeignReviewer } from '../domain';
import type { ServiceError } from './change-proposal-service-types';

const COUNT_BY_KIND: Record<
  ReviewerKind,
  (ids: readonly string[]) => Promise<number>
> = {
  user: (ids) => prisma.users.count({ where: { id: { in: [...ids] } } }),
  'user-group': (ids) =>
    prisma.usergroups.count({ where: { id: { in: [...ids] } } }),
  'external-user-group': (ids) =>
    prisma.externalusergroups.count({ where: { id: { in: [...ids] } } }),
};

// Expects distinct inputs (dedupeReviewerInputs), so a count below the id count means one is missing.
export const allReviewersExist = async (
  inputs: readonly ReviewerInput[],
): Promise<boolean> => {
  if (inputs.some((input) => !isValidObjectId(input.id))) {
    return false;
  }
  const counts = await Promise.all(
    Object.entries(COUNT_BY_KIND).map(async ([kind, count]) => {
      const ids = inputs.filter((i) => i.kind === kind).map((i) => i.id);
      return ids.length === 0 || (await count(ids)) === ids.length;
    }),
  );
  return counts.every(Boolean);
};

const toCreatedRef = (
  input: ReviewerInput,
  requesterId: string,
  createdAt: Date,
): ReviewerRef => ({
  kind: input.kind,
  id: input.id,
  addedBy: requesterId,
  addedAt: createdAt,
});

// The switch only guards reviewers given here; inherited ones were stored before (design: feature switch).
// No reviewers given passes with none, leaving the choice to inheritance or the default.
export const checkGivenReviewers = async (
  given: readonly ReviewerInput[] | undefined,
  requesterId: string,
  isReviewersEnabled: boolean,
  createdAt: Date,
): Promise<
  | { readonly ok: true; readonly reviewers?: readonly ReviewerRef[] }
  | { readonly ok: false; readonly error: ServiceError }
> => {
  if (given == null) {
    return { ok: true };
  }
  const reviewers = given.map((input) =>
    toCreatedRef(input, requesterId, createdAt),
  );
  if (!isReviewersEnabled && hasForeignReviewer(reviewers, requesterId)) {
    return { ok: false, error: { code: 'reviewers-disabled' } };
  }
  if (!(await allReviewersExist(given))) {
    return { ok: false, error: { code: 'reviewer-not-found' } };
  }
  return { ok: true, reviewers };
};

// A follow-up or rework takes over the base's reviewers as they stand now, added by this creation.
export const inheritReviewers = (
  baseReviewers: readonly ReviewerRef[],
  requesterId: string,
  createdAt: Date,
): readonly ReviewerRef[] =>
  activeReviewers(baseReviewers).map((reviewer) =>
    toCreatedRef(reviewer, requesterId, createdAt),
  );
