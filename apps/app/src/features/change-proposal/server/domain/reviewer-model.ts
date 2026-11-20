import type { ReviewerInput, ReviewerRef, ViewerRole } from '../../interfaces';

export type ViewerIdentity = {
  readonly userId: string;
  readonly userGroupIds: ReadonlySet<string>;
  readonly externalUserGroupIds: ReadonlySet<string>;
};

export const activeReviewers = (
  reviewers: readonly ReviewerRef[],
): readonly ReviewerRef[] => reviewers.filter((r) => r.removedAt == null);

const matchesViewer = (
  reviewer: ReviewerRef,
  viewer: ViewerIdentity,
): boolean => {
  switch (reviewer.kind) {
    case 'user':
      return reviewer.id === viewer.userId;
    case 'user-group':
      return viewer.userGroupIds.has(reviewer.id);
    case 'external-user-group':
      return viewer.externalUserGroupIds.has(reviewer.id);
  }
};

// With no active reviewers, the requester alone is the reviewer.
export const isReviewer = (
  reviewers: readonly ReviewerRef[],
  requesterId: string,
  viewer: ViewerIdentity,
): boolean => {
  const active = activeReviewers(reviewers);
  if (active.length === 0) {
    return viewer.userId === requesterId;
  }
  return active.some((r) => matchesViewer(r, viewer));
};

// A group never counts as the requester, even if its id happens to equal the requester id.
export const hasForeignReviewer = (
  reviewers: readonly ReviewerRef[],
  requesterId: string,
): boolean =>
  activeReviewers(reviewers).some(
    (r) => !(r.kind === 'user' && r.id === requesterId),
  );

export const dedupeReviewerInputs = (
  inputs: readonly ReviewerInput[],
): readonly ReviewerInput[] => {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = `${input.kind}:${input.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const deriveViewerRole = (
  requesterId: string,
  reviewers: readonly ReviewerRef[],
  viewer: ViewerIdentity,
): ViewerRole => {
  if (viewer.userId === requesterId) {
    return 'requester';
  }
  return isReviewer(reviewers, requesterId, viewer) ? 'reviewer' : 'other';
};
