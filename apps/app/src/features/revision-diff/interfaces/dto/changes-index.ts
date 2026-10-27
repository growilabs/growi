/**
 * DTO types for the Changes Index API
 * GET /api/v3/revisions/changes
 *
 * Usable from both server and client — no server-side-only imports.
 * On the wire, ObjectIds and dates are plain strings (JSON has no ObjectId/Date type);
 * the server parses/normalizes them at the route boundary.
 */

/**
 * Request query parameters for GET /api/v3/revisions/changes.
 *
 * Every value is a string because HTTP query parameters are always strings. The route
 * validates them (ISO 8601 dates, integer `limit`, opaque `cursor`) and parses them into
 * a normalized internal form before handing them to the service. All fields are optional;
 * the server applies defaults and range validation.
 */
export interface ChangesIndexRequestQuery {
  since?: string; // ISO 8601 — inclusive lower bound
  fromDate?: string; // ISO 8601 — start of date range (inclusive)
  toDate?: string; // ISO 8601 — end of date range (inclusive)
  limit?: string; // integer as string; parsed and clamped in the route
  cursor?: string; // opaque pagination cursor from a prior response's `next`
}

/**
 * A single response entry representing a "run" of the authenticated user's consecutive
 * edits on a page. `path` is null iff `accessible === false`.
 */
export interface ChangesIndexEntry {
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
 * Response body for GET /api/v3/revisions/changes.
 * `next` is a cursor token when more results exist, otherwise null.
 */
export interface ChangesIndexResponse {
  changes: ChangesIndexEntry[];
  next: string | null;
}
