import type { IUserHasId } from '@growi/core';

import { prisma } from '~/utils/prisma';

import {
  APPLIED_AT_LEAST_ONCE_STATUSES,
  type ChangeProposalSummaryView,
} from '../../interfaces';
import {
  recordedPathOf,
  selectVisibleOperations,
  targetPageIdOf,
} from '../domain';
import type { AppliedListCursor } from '../models/change-proposal-types';
import type {
  ChangeProposalSummary,
  OperationSummaryRecord,
} from '../models/to-change-proposal-document';
import { loadViewablePages, type ViewablePages } from './current-page-facts';
import {
  contextFor,
  loadRevertCounterparts,
  type ProposalHeaderView,
  pageIdsOf,
  readRequesters,
  toProposalHeaderView,
} from './proposal-view-parts';
import type {
  RevertCounterpartFacts,
  RevertCounterpartSource,
} from './revert-counterparts';
import { readChangeProposalSettings } from './settings';

export type ProposalListQuery = {
  // page is 1-based; a page or limit that is not a positive integer yields an empty result
  listMine(
    viewer: IUserHasId,
    page: number,
    limit: number,
  ): Promise<{
    readonly items: readonly ChangeProposalSummaryView[];
    readonly hasNext: boolean;
  }>;
  // An unparseable cursor yields an empty result rather than restarting from the top.
  listAppliedVisible(
    viewer: IUserHasId,
    cursor: string | null,
    limit: number,
  ): Promise<{
    readonly items: readonly ChangeProposalSummaryView[];
    readonly nextCursor: string | null;
  }>;
};

export type AppliedListScan = {
  // documents read per findByIdsAndViewer round
  readonly batchSize: number;
  // documents read per request at most
  readonly limit: number;
};

const APPLIED_LIST_SCAN_BATCH = 50;
const APPLIED_LIST_SCAN_LIMIT = 500;
const DEFAULT_APPLIED_LIST_SCAN: AppliedListScan = {
  batchSize: APPLIED_LIST_SCAN_BATCH,
  limit: APPLIED_LIST_SCAN_LIMIT,
};

const CURSOR_PATTERN = /^(\d{1,15})-([0-9a-f]{24})$/;

const encodeCursor = (cursor: AppliedListCursor): string =>
  `${cursor.lastAppliedAt.getTime()}-${cursor.id}`;

// The route rejects a malformed cursor with 400 instead of the service's empty result.
export const isAppliedListCursor = (value: string): boolean =>
  CURSOR_PATTERN.test(value);

const decodeCursor = (value: string): AppliedListCursor | null => {
  const match = CURSOR_PATTERN.exec(value);
  return match == null
    ? null
    : { lastAppliedAt: new Date(Number(match[1])), id: match[2] };
};

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

type VisibleSummary = {
  readonly summary: ChangeProposalSummary;
  readonly visible: readonly OperationSummaryRecord[];
  readonly pages: ChangeProposalSummaryView['pages'];
};

type SummaryPage = ChangeProposalSummaryView['pages'][number];

// A page that is gone is named by the path recorded on the operation, if any.
const pageOf = (
  op: OperationSummaryRecord,
  viewable: ViewablePages,
  createdPaths: ReadonlyMap<string, string>,
): SummaryPage | undefined => {
  const pageId = targetPageIdOf(op);
  if (pageId == null) {
    return undefined;
  }
  const page = viewable.pages.get(pageId);
  if (page != null) {
    return { id: pageId, path: page.path };
  }
  if (!viewable.deletedPageIds.has(pageId)) {
    return undefined;
  }
  const path = recordedPathOf(op, createdPaths);
  return path == null ? { id: pageId } : { id: pageId, path };
};

const visiblePagesOf = (
  visible: readonly OperationSummaryRecord[],
  viewable: ViewablePages,
  createdPaths: ReadonlyMap<string, string>,
): ChangeProposalSummaryView['pages'] => {
  const seen = new Set<string>();
  return visible.flatMap((op) => {
    const page = pageOf(op, viewable, createdPaths);
    if (page == null || seen.has(page.id)) {
      return [];
    }
    seen.add(page.id);
    return [page];
  });
};

// What filtering one read of summaries needs, loaded once for all of them.
type SummaryVisibility = {
  readonly viewable: ViewablePages;
  readonly counterpartsOf: (
    proposal: RevertCounterpartSource,
  ) => RevertCounterpartFacts;
};

const loadSummaryVisibility = async (
  rows: readonly ChangeProposalSummary[],
  viewer: IUserHasId,
): Promise<SummaryVisibility> => {
  const viewable = await loadViewablePages(
    rows.flatMap((row) => pageIdsOf(row.operations)),
    viewer,
  );
  const counterpartsOf = await loadRevertCounterparts(
    rows,
    viewer._id.toString(),
    viewable.deletedPageIds,
  );
  return { viewable, counterpartsOf };
};

const toVisibleSummary = (
  summary: ChangeProposalSummary,
  viewerId: string,
  { viewable, counterpartsOf }: SummaryVisibility,
): VisibleSummary => {
  const counterpart = counterpartsOf(summary);
  const visible = selectVisibleOperations(
    summary.operations,
    contextFor(summary.requester, viewerId, viewable, counterpart),
  );
  return {
    summary,
    visible,
    pages: visiblePagesOf(visible, viewable, counterpart.createdPaths),
  };
};

// Requester names and the admin setting are read once for the whole list.
const toSummaryViews = async (
  entries: readonly VisibleSummary[],
  viewerId: string,
): Promise<ChangeProposalSummaryView[]> => {
  const requesterOf = await readRequesters(
    entries.map((entry) => entry.summary.requester),
  );
  const isPerPageNotificationsEnabled =
    readChangeProposalSettings().perPageNotificationsEnabled;
  return entries.map(({ summary, visible, pages }) => {
    const header: ProposalHeaderView = toProposalHeaderView({
      id: summary.id,
      proposal: summary,
      visible,
      isRequester: summary.requester === viewerId,
      requester: requesterOf(summary.requester),
      isPerPageNotificationsEnabled,
    });
    return { ...header, pages };
  });
};

const hasAppliedOperation = (entry: VisibleSummary): boolean =>
  entry.visible.some((op) =>
    APPLIED_AT_LEAST_ONCE_STATUSES.includes(op.status),
  );

const positionOf = (summary: ChangeProposalSummary): AppliedListCursor => {
  if (summary.lastAppliedAt == null) {
    throw new Error(`Applied proposal ${summary.id} has no lastAppliedAt`);
  }
  return { lastAppliedAt: summary.lastAppliedAt, id: summary.id };
};

/**
 * Scans applied proposals in stored lastAppliedAt order until `limit` visible
 * ones are found or the scan budget is spent. The cursor is the position of
 * the last document consumed, so documents scanned but not returned are not lost.
 */
const scanAppliedVisible = async (
  viewer: IUserHasId,
  start: AppliedListCursor | null,
  limit: number,
  scan: AppliedListScan,
): Promise<{
  readonly matched: readonly VisibleSummary[];
  readonly next: AppliedListCursor | null;
}> => {
  const viewerId = viewer._id.toString();
  const matched: VisibleSummary[] = [];
  let position = start;
  let scanned = 0;
  while (matched.length < limit && scanned < scan.limit) {
    const take = Math.min(scan.batchSize, scan.limit - scanned);
    // biome-ignore lint/performance/noAwaitInLoops: each batch starts where the previous one ended
    const rows = await prisma.changeproposals.listAppliedAfterCursor(
      position,
      take,
    );
    const visibility = await loadSummaryVisibility(rows, viewer);
    for (const row of rows) {
      scanned += 1;
      position = positionOf(row);
      const entry = toVisibleSummary(row, viewerId, visibility);
      if (hasAppliedOperation(entry)) {
        matched.push(entry);
        if (matched.length === limit) {
          return { matched, next: position };
        }
      }
    }
    if (rows.length < take) {
      return { matched, next: null };
    }
  }
  return { matched, next: position };
};

export const createProposalListQuery = (
  scan: AppliedListScan = DEFAULT_APPLIED_LIST_SCAN,
): ProposalListQuery => ({
  async listMine(viewer, page, limit) {
    if (!isPositiveInteger(page) || !isPositiveInteger(limit)) {
      return { items: [], hasNext: false };
    }
    const viewerId = viewer._id.toString();
    // One extra row tells whether another page follows.
    const rows = await prisma.changeproposals.listByRequester(viewerId, {
      skip: (page - 1) * limit,
      take: limit + 1,
    });
    const pageRows = rows.slice(0, limit);
    const visibility = await loadSummaryVisibility(pageRows, viewer);
    const items = await toSummaryViews(
      pageRows.map((row) => toVisibleSummary(row, viewerId, visibility)),
      viewerId,
    );
    return { items, hasNext: rows.length > limit };
  },

  async listAppliedVisible(viewer, cursor, limit) {
    const start = cursor == null ? null : decodeCursor(cursor);
    if ((cursor != null && start == null) || !isPositiveInteger(limit)) {
      return { items: [], nextCursor: null };
    }
    const { matched, next } = await scanAppliedVisible(
      viewer,
      start,
      limit,
      scan,
    );
    return {
      items: await toSummaryViews(matched, viewer._id.toString()),
      nextCursor: next == null ? null : encodeCursor(next),
    };
  },
});
