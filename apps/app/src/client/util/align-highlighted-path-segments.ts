import { DevidedPagePath } from '@growi/core/dist/models';
import { normalizePath } from '@growi/core/dist/utils/path-utils';

// Elasticsearch wraps each hit in `<em class='highlighted-keyword'>…</em>`
// (re-serialized by FilterXSS on the server). The closing tag's `/` is the only
// `/` in a highlighted path that is not a path separator.
const EM_TAG_PATTERN = /<\/?em\b[^>]*>/g;
const SEPARATOR_OUTSIDE_TAG_PATTERN = /(?<!<)\//;

const toSegments = (path: string, separator: string | RegExp): string[] =>
  path.split(separator).filter((segment) => segment.length > 0);

// A segment whose <em> is cut by a `/` (e.g. `<em>B` / `C</em>`) must not be
// injected as HTML: the browser would auto-close it and silently drop the mark.
const hasBalancedEmTags = (html: string): boolean => {
  let depth = 0;
  for (const [tag] of html.matchAll(EM_TAG_PATTERN)) {
    depth += tag.startsWith('</') ? -1 : 1;
    if (depth < 0 || depth > 1) {
      return false;
    }
  }
  return depth === 0;
};

const isHighlightOf = (plainSegment: string, highlighted: string): boolean =>
  hasBalancedEmTags(highlighted) &&
  highlighted.replace(EM_TAG_PATTERN, '') === plainSegment;

/**
 * Pair every segment of `path` (root-first) with its highlighted markup from
 * `highlightedPath`. An entry is `undefined` when that segment's markup cannot
 * be trusted to show the same text -- callers render it as plain text.
 *
 * Segments are split on `/` outside tags and each pairing is verified by
 * text, so an `<em>` never shifts the correspondence (unlike re-running
 * `DevidedPagePath` on the markup, whose regexes can match the `/` of `</em>`).
 */
export const alignHighlightedPathSegments = (
  path: string,
  highlightedPath?: string | null,
): readonly (string | undefined)[] => {
  const plainSegments = toSegments(normalizePath(path), '/');
  if (!highlightedPath) {
    return plainSegments.map(() => undefined);
  }

  const highlightedSegments = toSegments(
    highlightedPath,
    SEPARATOR_OUTSIDE_TAG_PATTERN,
  );
  if (plainSegments.length !== highlightedSegments.length) {
    return plainSegments.map(() => undefined);
  }

  return plainSegments.map((plainSegment, index) => {
    const highlighted = highlightedSegments[index];
    return isHighlightOf(plainSegment, highlighted) ? highlighted : undefined;
  });
};

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/**
 * The page name of `path` with trailing-date bundling (`evalDatePath`) applied.
 *
 * - With `highlightedPath`: an HTML string for the caller to inject — the
 *   highlight markup when every segment it spans is reliably highlighted,
 *   otherwise the plain page name HTML-escaped (the plain path is not sanitized
 *   like the server-side highlight is).
 * - Without it: the plain page name as text, for the caller to render as text.
 */
export const buildHighlightedPageName = (
  path: string,
  highlightedPath?: string | null,
): string => {
  const devided = new DevidedPagePath(path, false, true);
  if (devided.isRoot || highlightedPath == null) {
    return devided.latter;
  }

  const plainSegments = toSegments(devided.latter, '/');
  const pageNameSegments = alignHighlightedPathSegments(
    path,
    highlightedPath,
  ).slice(-plainSegments.length);

  if (!pageNameSegments.every((segment) => segment != null)) {
    return escapeHtml(devided.latter);
  }
  // A segment equal to its plain text carries no highlight and is still plain
  // text (possibly with `&` or entity-like sequences), so escape it too.
  return pageNameSegments
    .map((segment, index) =>
      segment === plainSegments[index] ? escapeHtml(segment) : segment,
    )
    .join('/');
};
