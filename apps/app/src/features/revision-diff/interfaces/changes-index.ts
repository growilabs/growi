/**
 * DTO types for Changes Index API
 * GET /api/v3/revisions/changes
 *
 * Usable from both server and client — no server-side-only imports.
 */

/**
 * A single entry representing a "run" of the authenticated user's consecutive edits on a page.
 * `path` is null iff `accessible === false`.
 */
export interface ChangeIndexEntry {
  pageId: string;
  path: string | null; // null iff accessible === false
  fromRevisionId: string | null; // null means the run starts from page creation (no prior revision)
  toRevisionId: string;
  authorId: string; // always the authenticated user
  latestUpdatedAt: string; // ISO 8601 — equals toRevision.createdAt
  accessible: boolean;
  deleted: boolean;
}

/**
 * Query parameters for GET /api/v3/revisions/changes (external HTTP DTO).
 * All fields are optional; the server applies defaults and validates ranges.
 */
export interface ChangesIndexQuery {
  since?: string; // ISO 8601 — inclusive lower bound
  fromDate?: string; // ISO 8601 — start of date range (inclusive)
  toDate?: string; // ISO 8601 — end of date range (inclusive)
  limit?: number;
  cursor?: string;
}

/**
 * Response body for GET /api/v3/revisions/changes.
 * `next` is a cursor token when more results exist, otherwise null.
 */
export interface ChangesIndexResult {
  changes: ChangeIndexEntry[];
  next: string | null;
}
