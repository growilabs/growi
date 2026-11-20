import { pagePathUtils } from '@growi/core/dist/utils';

const { encodeSpaces } = pagePathUtils;

/**
 * Build the permalink-style ".md" URL for a page: "/{pageId}.md".
 *
 * This is the single source of truth for the permalink-form ".md" URL shape,
 * shared by the CopyDropdown UI, the page Head alternate link, and the
 * server-side navigation footer.
 *
 * @param pageId - the page's permalink ID
 * @param origin - optional origin (protocol + host) to produce an absolute URL;
 *   omit to produce a relative URL
 */
export const toPermalinkMdUrl = (pageId: string, origin?: string): string => {
  return `${origin ?? ''}/${pageId}.md`;
};

/**
 * Build the path-style ".md" URL for a page.
 *
 * ".md" is inserted immediately before the query string and/or hash fragment,
 * if present, so the suffix lands on the path rather than the query/hash
 * (e.g. "/foo/bar?rev=1" -> "/foo/bar.md?rev=1", "/foo#sec" -> "/foo.md#sec").
 * ".md" is appended unconditionally, even when the path already ends with
 * ".md" (e.g. "/README.md" -> "/README.md.md"); resolving that collision
 * against real pages is the server's responsibility (Requirement 2 / 7.3).
 *
 * @param pagePathUrl - the page path, optionally including an origin and/or
 *   a query string/hash fragment
 * @param origin - optional origin (protocol + host) to prefix; omit if
 *   pagePathUrl already includes one, or to produce a relative URL
 */
export const toPathMdUrl = (pagePathUrl: string, origin?: string): string => {
  const separatorIndex = pagePathUrl.search(/[?#]/);
  const path =
    separatorIndex === -1 ? pagePathUrl : pagePathUrl.slice(0, separatorIndex);
  const queryAndHash =
    separatorIndex === -1 ? '' : pagePathUrl.slice(separatorIndex);

  return `${origin ?? ''}${encodeSpaces(path) ?? path}.md${queryAndHash}`;
};
