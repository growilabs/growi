import { prisma } from '~/utils/prisma';

import type { ChangeProposalSummaryView } from '../../interfaces';
import { deriveViewerRole, type ViewerIdentity } from '../domain';
import type {
  ChangeProposalSummary,
  OperationSummaryRecord,
} from '../models/to-change-proposal-document';
import { readParticipantNames } from './participant-names';
import {
  type AppliedListScan,
  DEFAULT_APPLIED_LIST_SCAN,
  isPositiveInteger,
  visiblePagesOf,
} from './proposal-list-query';
import { toProposalHeaderView } from './proposal-view-parts';
import { resolveReviewScopesWithPages } from './review-scope-resolver';
import { toParticipantHeaderFields } from './review-views';
import { readChangeProposalSettings } from './settings';

export type ReviewQueuePage = {
  readonly items: readonly ChangeProposalSummaryView[];
  readonly nextCursor: string | null;
};

export type ReviewQueueScan = AppliedListScan;

export type ReviewQueueQuery = {
  // An unparseable cursor yields an empty result rather than restarting from the top.
  listReviewQueue(
    viewer: ViewerIdentity,
    cursor: string | null,
    limit: number,
  ): Promise<ReviewQueuePage>;
};

// The same budget as the applied list.
const REVIEW_QUEUE_SCAN_LIMIT: ReviewQueueScan = DEFAULT_APPLIED_LIST_SCAN;

const CURSOR_PATTERN = /^[0-9a-f]{24}$/;

// The route rejects a malformed cursor with 400 instead of the service's empty result.
export const isReviewQueueCursor = (value: string): boolean =>
  CURSOR_PATTERN.test(value);

type QueueEntry = {
  readonly summary: ChangeProposalSummary;
  readonly visible: readonly OperationSummaryRecord[];
  readonly pages: ChangeProposalSummaryView['pages'];
};

/**
 * Keeps, in row order, the rows where the viewer is a reviewer with at least
 * one decision target; the others are null. One viewing check for the batch.
 */
const toQueueEntries = async (
  rows: readonly ChangeProposalSummary[],
  viewer: ViewerIdentity,
): Promise<(QueueEntry | null)[]> => {
  // A requester naming themselves, or their own group, finds the proposal in their own list.
  const reviewerRows = rows.filter(
    (row) =>
      deriveViewerRole(row.requester, row.reviewers, viewer) === 'reviewer',
  );
  const { scopes, viewable } = await resolveReviewScopesWithPages(
    reviewerRows.map((row) => ({
      operations: row.operations,
      role: 'reviewer' as const,
    })),
    viewer,
    [],
  );
  const entryById = new Map(
    reviewerRows.flatMap((summary, i) => {
      const scope = scopes[i];
      if (scope.reviewTargetKeys.size === 0) {
        return [];
      }
      const visible = summary.operations.filter((op) =>
        scope.visibleKeys.has(op.key),
      );
      const pages = visiblePagesOf(visible, viewable);
      return [[summary.id, { summary, visible, pages }] as const];
    }),
  );
  return rows.map((row) => entryById.get(row.id) ?? null);
};

/**
 * Scans the viewer's open proposals oldest first until `limit` entries are
 * found or the scan budget is spent. The cursor is the id of the last listed
 * proposal, so the next call scans again what was scanned past it.
 */
const scanReviewQueue = async (
  viewer: ViewerIdentity,
  start: string | null,
  limit: number,
  scan: ReviewQueueScan,
): Promise<{
  readonly matched: readonly QueueEntry[];
  readonly next: string | null;
}> => {
  const matched: QueueEntry[] = [];
  let position = start;
  let lastListed: string | null = null;
  let scanned = 0;
  while (matched.length < limit && scanned < scan.limit) {
    const take = Math.min(scan.batchSize, scan.limit - scanned);
    // biome-ignore lint/performance/noAwaitInLoops: each batch starts where the previous one ended
    const rows = await prisma.changeproposals.listReviewQueueAfter(
      viewer,
      position,
      take,
    );
    const entries = await toQueueEntries(rows, viewer);
    for (const [i, row] of rows.entries()) {
      scanned += 1;
      position = row.id;
      const entry = entries[i];
      if (entry != null) {
        matched.push(entry);
        lastListed = row.id;
        if (matched.length === limit) {
          return { matched, next: lastListed };
        }
      }
    }
    if (rows.length < take) {
      return { matched, next: null };
    }
  }
  // Never the last scanned id (it reveals the proposal is open) nor the input
  // cursor (the client would loop); see design.md review-queue-query's owner decision.
  return { matched, next: lastListed };
};

// Names are read once for the whole page.
const toSummaryViews = async (
  entries: readonly QueueEntry[],
): Promise<ChangeProposalSummaryView[]> => {
  const reviewers = entries.flatMap((e) => e.summary.reviewers);
  const { userOf, groupNameOf } = await readParticipantNames(
    [
      ...entries.map((e) => e.summary.requester),
      ...reviewers.flatMap((r) => [
        ...(r.kind === 'user' ? [r.id] : []),
        r.addedBy,
        ...(r.removedBy == null ? [] : [r.removedBy]),
      ]),
    ],
    reviewers,
  );
  const isPerPageNotificationsEnabled =
    readChangeProposalSettings().perPageNotificationsEnabled;
  return entries.map(({ summary, visible, pages }) => ({
    ...toProposalHeaderView({
      id: summary.id,
      proposal: summary,
      visible,
      role: 'reviewer',
      requester: userOf(summary.requester),
      isPerPageNotificationsEnabled,
    }),
    // A reviewer gets no whole-proposal rejections, so no records are passed.
    ...toParticipantHeaderFields({
      role: 'reviewer',
      purpose: summary.purpose,
      reviewers: summary.reviewers,
      latest: [],
      userOf,
      groupNameOf,
    }),
    pages,
  }));
};

export const createReviewQueueQuery = (
  scan: ReviewQueueScan = REVIEW_QUEUE_SCAN_LIMIT,
): ReviewQueueQuery => ({
  async listReviewQueue(viewer, cursor, limit) {
    if (
      (cursor != null && !isReviewQueueCursor(cursor)) ||
      !isPositiveInteger(limit)
    ) {
      return { items: [], nextCursor: null };
    }
    const { matched, next } = await scanReviewQueue(
      viewer,
      cursor,
      limit,
      scan,
    );
    return { items: await toSummaryViews(matched), nextCursor: next };
  },
});
