/**
 * DTO types for Revision Diff API
 * POST /api/v3/revisions/diff
 *
 * Usable from both server and client — no server-side-only imports.
 */

/**
 * A single revision pair to diff.
 * `fromRevisionId === null` means the baseline is the empty string (page creation).
 */
export interface RevisionDiffPairInput {
  pageId: string;
  fromRevisionId: string | null;
  toRevisionId: string;
}

/**
 * Request body for POST /api/v3/revisions/diff.
 * `contextLines` defaults to 3 when omitted.
 */
export interface RevisionDiffRequest {
  pairs: RevisionDiffPairInput[];
  contextLines?: number;
}

/**
 * Per-pair result — discriminated union on `status`.
 *
 * - `ok`: diff was computed successfully; `diff` contains the unified diff string.
 * - `forbidden`: the authenticated user cannot view the target page; no content disclosed.
 * - `invalid`: the pair is structurally inconsistent (revision does not belong to the page,
 *              revision/page not found, etc.); no content disclosed.
 */
export type RevisionDiffResult =
  | { pageId: string; toRevisionId: string; status: 'ok'; diff: string }
  | { pageId: string; toRevisionId: string; status: 'forbidden' }
  | { pageId: string; toRevisionId: string; status: 'invalid' };

/**
 * Response body for POST /api/v3/revisions/diff.
 * The `results` array has the same length as the request `pairs` array (same order).
 */
export interface RevisionDiffResponse {
  results: RevisionDiffResult[];
}
