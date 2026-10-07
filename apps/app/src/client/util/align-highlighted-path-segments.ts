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

/**
 * The page name of `path` with trailing-date bundling (`evalDatePath`) applied,
 * carrying its highlight markup when every segment it spans is reliably
 * highlighted, otherwise the plain page name.
 */
export const buildHighlightedPageName = (
  path: string,
  highlightedPath?: string | null,
): string => {
  const devided = new DevidedPagePath(path, false, true);
  if (devided.isRoot) {
    return devided.latter;
  }

  const pageNameSegmentCount = toSegments(devided.latter, '/').length;
  const pageNameSegments = alignHighlightedPathSegments(
    path,
    highlightedPath,
  ).slice(-pageNameSegmentCount);

  return pageNameSegments.every((segment) => segment != null)
    ? pageNameSegments.join('/')
    : devided.latter;
};
