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
 * When explicit=false and kind='path', `path` is returned UNMODIFIED (still
 * carrying its trailing `.md`, if any) -- literal-vs-base resolution is owned
 * by the caller (respondWithPageMarkdown), not by this pure classifier.
 */
export type MarkdownRequestIntent =
  | { kind: 'none' }
  | { kind: 'permalink'; pageId: string; explicit: boolean }
  | { kind: 'path'; path: string; explicit: boolean };

const MARKDOWN_MEDIA_TYPE = 'text/markdown';
const MARKDOWN_SUFFIX = '.md';

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
 *    priority and never strips a trailing `.md` from the path.
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
  const explicit = hasExplicitMarkdownAccept(accept) || formatQuery === 'md';

  if (explicit) {
    return classifyPath(reqPath, true);
  }

  if (!reqPath.endsWith(MARKDOWN_SUFFIX)) {
    return { kind: 'none' };
  }

  const base = reqPath.slice(0, -MARKDOWN_SUFFIX.length);
  if (isPermalink(base)) {
    return { kind: 'permalink', pageId: base.substring(1), explicit: false };
  }

  // Not a permalink: keep the ORIGINAL (still `.md`-suffixed) path. The
  // caller owns literal-vs-base resolution (task 2.2).
  return { kind: 'path', path: reqPath, explicit: false };
}
