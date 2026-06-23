/**
 * RevisionDiffService — per-pair authorization and unified diff computation.
 *
 * Task 3.1 scope: pure computeDiffForPair function and MAX_PAIRS constant.
 * The full service class (with DB access) is wired in later tasks.
 */

import type { Types } from 'mongoose';

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

export interface RevisionDiffService {
  computeDiffs(
    userId: string,
    request: NormalizedDiffRequest,
  ): Promise<readonly RevisionDiffResult[]>;
}
