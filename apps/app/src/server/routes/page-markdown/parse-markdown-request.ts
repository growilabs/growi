import { isPermalink } from '@growi/core/dist/utils/page-path-utils';

/**
 * The caller's interpretation of a request as a markdown-format request.
 *
 * - 'none': not a markdown request at all -- the caller should call next().
 * - 'permalink': the requested path is a permalink (/{24-hex ObjectId}[.md]).
 * - 'path': the requested path is an ordinary page path (possibly ending with .md).
 *
 * `explicit` distinguishes the two ways a markdown request can be signaled:
 * - true:  Accept: text/markdown (explicit media type) or ?format=md
 * - false: bare `.md` suffix (sugar)
 *
 * The returned `path` / `pageId` are PERCENT-DECODED (the form page paths are
 * stored in), since Express's req.path arrives still encoded. Apart from
 * decoding, when explicit=false and kind='path' the `path` is unmodified
 * (still carrying its trailing `.md`, if any) -- literal-vs-base resolution is
 * owned by the caller (respondWithPageMarkdown), not by this pure classifier.
 */
export type MarkdownRequestIntent =
  | { kind: 'none' }
  | { kind: 'permalink'; pageId: string; explicit: boolean }
  | { kind: 'path'; path: string; explicit: boolean };

const MARKDOWN_MEDIA_TYPE = 'text/markdown';
const MARKDOWN_SUFFIX = '.md';

/**
 * Decode a percent-encoded request path into the page-path form stored in the
 * database. Express's `req.path` is NOT percent-decoded (a request for
 * "/foo bar.md" arrives as "/foo%20bar.md"), while GROWI stores page paths
 * decoded, so classification and resolution must operate on the decoded form
 * or every space-/non-ASCII-containing path resolves to a false 404.
 *
 * Malformed escape sequences fall back to the raw path. (In practice Express
 * itself rejects those with a 400 while matching the `/*` wildcard, before
 * any handler runs -- the fallback is defense for direct helper callers.)
 */
function decodeRequestPath(reqPath: string): string {
  try {
    return decodeURIComponent(reqPath);
  } catch {
    return reqPath;
  }
}

/**
 * Whether the Accept header explicitly lists text/markdown as a media type.
 *
 * Deliberately NOT equivalent to Express's `req.accepts()`, which treats a
 * wildcard such as "any type" (curl's default Accept) as a match for
 * anything. Here, only an exact `text/markdown` entry (ignoring `;q=...`
 * parameters and surrounding whitespace, case-insensitively) counts.
 */
function hasExplicitMarkdownAccept(accept: string | undefined): boolean {
  if (accept == null || accept.length === 0) {
    return false;
  }

  return accept
    .split(',')
    .map((entry) => entry.split(';')[0].trim().toLowerCase())
    .includes(MARKDOWN_MEDIA_TYPE);
}

/**
 * Classify a path (with no further suffix stripping) as permalink or ordinary path.
 */
function classifyPath(path: string, explicit: boolean): MarkdownRequestIntent {
  if (isPermalink(path)) {
    // isPermalink already validated that path.substring(1) is a valid ObjectId.
    return { kind: 'permalink', pageId: path.substring(1), explicit };
  }
  return { kind: 'path', path, explicit };
}

/**
 * Interpret an incoming request as a markdown-format request, without
 * touching Express types or performing any I/O.
 *
 * Judgment order (see design.md System Flows):
 * 1. Explicit intent (Accept: text/markdown or ?format=md) takes top
 *    priority. The path is kept unstripped, EXCEPT that `/{pageId}.md` is
 *    recognized as a permalink (such a literal page path cannot exist);
 *    literal-first/base-fallback resolution is deferred to the caller.
 * 2. Otherwise, a `.md` suffix (exact, case-sensitive -- `.mdx` does not
 *    count) is treated as sugar; literal-vs-base resolution is deferred to
 *    the caller.
 * 3. Otherwise, this is not a markdown request at all.
 */
export function parseMarkdownRequest(
  reqPath: string,
  accept: string | undefined,
  formatQuery: string | undefined,
): MarkdownRequestIntent {
  // All classification and the returned `path` operate on the DECODED form,
  // matching how page paths are stored (see decodeRequestPath).
  const path = decodeRequestPath(reqPath);
  const explicit = hasExplicitMarkdownAccept(accept) || formatQuery === 'md';

  if (explicit) {
    // A permalink carrying the `.md` sugar suffix: `/{24hex}.md` can never be
    // a real page path (isCreatablePage reserves trailing `.md`), so treating
    // it as a permalink loses nothing and keeps footer-distributed `.md`
    // permalinks working for clients that also send an explicit signal.
    if (path.endsWith(MARKDOWN_SUFFIX)) {
      const stripped = path.slice(0, -MARKDOWN_SUFFIX.length);
      if (isPermalink(stripped)) {
        return {
          kind: 'permalink',
          pageId: stripped.substring(1),
          explicit: true,
        };
      }
    }
    return classifyPath(path, true);
  }

  if (!path.endsWith(MARKDOWN_SUFFIX)) {
    return { kind: 'none' };
  }

  const base = path.slice(0, -MARKDOWN_SUFFIX.length);
  if (isPermalink(base)) {
    return { kind: 'permalink', pageId: base.substring(1), explicit: false };
  }

  // Not a permalink: keep the ORIGINAL (still `.md`-suffixed) path. The
  // caller owns literal-vs-base resolution (task 2.2).
  return { kind: 'path', path, explicit: false };
}
