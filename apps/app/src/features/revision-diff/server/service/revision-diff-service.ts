/**
 * RevisionDiffService — per-pair authorization and unified diff computation.
 *
 * This module owns the full diff logic: the per-batch bulk fetch, per-pair independent
 * authorization (`computeDiffForPair`, pure) and the `computeDiffs` orchestration that
 * runs them over a batch. The route layer is a thin adapter that validates the request
 * and delegates to `computeDiffs`.
 */

import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import type {
  RevisionDiffPairInput,
  RevisionDiffResult,
} from '../../interfaces/revision-diff';
import { buildUnifiedDiff } from '../diff-core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of revision pairs allowed in a single diff request.
 * Requests exceeding this limit are rejected at the route layer with HTTP 400.
 */
export const MAX_PAIRS = 20;

// ---------------------------------------------------------------------------
// Internal data shapes
// ---------------------------------------------------------------------------

/**
 * Minimal revision document shape required by computeDiffForPair.
 * Only the fields needed for ownership validation and diff computation are included.
 */
export interface RevisionDoc {
  readonly _id: Types.ObjectId;
  readonly pageId: Types.ObjectId;
  readonly body: string;
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

/**
 * Compute the diff result for a single revision pair given pre-fetched data.
 *
 * This is a pure function — it performs no DB calls.  Callers (the service
 * implementation) are responsible for fetching the required data and passing it in.
 *
 * Algorithm:
 *  1. Check whether the requesting user can access the target page.
 *     If not → { status: 'forbidden' }  (no content disclosed)
 *  2. Validate that toRevision exists and belongs to the specified pageId.
 *     If not → { status: 'invalid' }    (no content disclosed)
 *  3. Validate fromRevision when fromRevisionId is non-null.
 *     If not found or wrong page → { status: 'invalid' }
 *  4. When fromRevisionId is null, treat the baseline as the empty string (page creation).
 *  5. Compute unified diff and return { status: 'ok', diff }.
 *
 * Authorization is always performed independently per pair, regardless of the
 * caller's origin (requirement 7.1 / design "① 由来か否かに依らず毎回独立認可").
 *
 * @param pair              - The revision pair to evaluate.
 * @param accessiblePageIds - Set of page ID strings the viewer can currently access.
 * @param revisionMap       - Map of revision ID string → RevisionDoc (pre-fetched for this batch).
 * @param contextLines      - Number of unified diff context lines.
 * @returns RevisionDiffResult discriminated union.
 */
export function computeDiffForPair(
  pair: RevisionDiffPairInput,
  accessiblePageIds: Set<string>,
  revisionMap: Map<string, RevisionDoc>,
  contextLines: number,
): RevisionDiffResult {
  const { pageId, fromRevisionId, toRevisionId } = pair;

  // Step 1: authorization — is the current user allowed to see this page?
  if (!accessiblePageIds.has(pageId)) {
    return { status: 'forbidden', pageId, toRevisionId };
  }

  // Step 2: validate toRevision — must exist and belong to the specified pageId.
  const toRevision = revisionMap.get(toRevisionId);
  if (toRevision == null || toRevision.pageId.toString() !== pageId) {
    return { status: 'invalid', pageId, toRevisionId };
  }

  // Step 3: validate fromRevision (when specified).
  let fromBody = '';
  if (fromRevisionId !== null) {
    const fromRevision = revisionMap.get(fromRevisionId);
    if (fromRevision == null || fromRevision.pageId.toString() !== pageId) {
      return { status: 'invalid', pageId, toRevisionId };
    }
    fromBody = fromRevision.body;
  }
  // When fromRevisionId === null, fromBody stays '' (full-add diff — page creation baseline).

  // Step 4: compute unified diff.
  const diff = buildUnifiedDiff(
    pageId,
    fromBody,
    toRevision.body,
    contextLines,
  );
  return { status: 'ok', pageId, toRevisionId, diff };
}

// ---------------------------------------------------------------------------
// Service interface (full implementation wired in later tasks)
// ---------------------------------------------------------------------------

export interface NormalizedDiffRequest {
  readonly pairs: readonly RevisionDiffPairInput[];
  readonly contextLines: number;
}

// ---------------------------------------------------------------------------
// Service entry point — computeDiffs
// ---------------------------------------------------------------------------

/**
 * Fetch accessible pages and revisions for the given batch, then compute per-pair
 * diff results.
 *
 * This is the concrete RevisionDiffService.computeDiffs implementation (design.md
 * "Service Interface"). The route layer is a thin adapter: it authenticates, validates
 * (incl. MAX_PAIRS) and delegates here.
 *
 * The design contract is `computeDiffs(userId, request)`. We accept the full `user`
 * document because the page-accessibility bulk check (`Page.findByIdsAndViewer`)
 * requires it. Authorization is performed independently per pair regardless of origin
 * (Req 7.1 / 7.5).
 *
 * Pipeline:
 *   1. Collect unique pageIds and revisionIds from the pairs.
 *   2. Page.findByIdsAndViewer(pageIds, user) → accessible page-id set.
 *   3. Revision.find({ _id: { $in } }) → revision map (id → RevisionDoc).
 *   4. computeDiffForPair() per pair (pure) → results in input order.
 */
export async function computeDiffs(
  user: IUserHasId,
  request: NormalizedDiffRequest,
): Promise<readonly RevisionDiffResult[]> {
  const { pairs, contextLines } = request;

  // Collect unique pageIds and revisionIds for bulk queries.
  const pageIds: Types.ObjectId[] = [];
  const revisionIds: Types.ObjectId[] = [];

  for (const pair of pairs) {
    pageIds.push(new Types.ObjectId(pair.pageId));
    revisionIds.push(new Types.ObjectId(pair.toRevisionId));
    if (pair.fromRevisionId != null) {
      revisionIds.push(new Types.ObjectId(pair.fromRevisionId));
    }
  }

  // Deduplicate to avoid redundant queries.
  const uniquePageIds = [
    ...new Map(pageIds.map((id) => [id.toString(), id])).values(),
  ];
  const uniqueRevisionIds = [
    ...new Map(revisionIds.map((id) => [id.toString(), id])).values(),
  ];

  // Bulk query 1: determine which pages the authenticated user can access.
  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );
  const accessiblePages: HydratedDocument<PageDocument>[] =
    await Page.findByIdsAndViewer(uniquePageIds, user, null);
  const accessiblePageIds = new Set(
    accessiblePages.map((p) => p._id.toString()),
  );

  // Bulk query 2: fetch revision documents needed for diff computation.
  const revisionDocs: RevisionDoc[] = await Revision.find(
    { _id: { $in: uniqueRevisionIds } },
    { _id: 1, pageId: 1, body: 1 },
  ).lean();
  const revisionMap = new Map<string, RevisionDoc>(
    revisionDocs.map((r) => [r._id.toString(), r]),
  );

  // Compute per-pair results in order.
  return pairs.map((pair) =>
    computeDiffForPair(pair, accessiblePageIds, revisionMap, contextLines),
  );
}
