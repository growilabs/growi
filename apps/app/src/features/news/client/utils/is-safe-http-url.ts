/**
 * Defense-in-depth: even though ingest-time validation rejects non-http(s)
 * URLs, the rendered value is exposed to whatever happens to be in the DB
 * (e.g. a row inserted before the validator existed). Re-check at render to
 * block `javascript:`, `data:`, and similar XSS vectors.
 *
 * Shared by NewsFeed (the "view detail" link) and NewsImage (the img src).
 */
export const isSafeHttpUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url);
