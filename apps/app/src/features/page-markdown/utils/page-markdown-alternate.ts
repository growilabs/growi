import { toPathMdUrl, toPermalinkMdUrl } from './page-markdown-url';

/**
 * Select the ".md" alternate URL for a page's machine-facing discovery link
 * (the HTML <head> `<link rel="alternate">`).
 *
 * Prefers the permalink form (`/{pageId}.md`) when the page id is known;
 * otherwise falls back to the path form (`{path}.md`) — the case of empty
 * (container) pages whose props carry no entity `_id` (Requirement 6.1).
 * Returns null when neither is available (rendered without page context), so
 * callers can omit the link rather than emit a broken href.
 *
 * URLs are relative (no origin), matching Requirement 6.1's `href="/{pageId}.md"`.
 */
export const selectAlternateMdUrl = (
  pageId: string | null | undefined,
  pathname: string | null | undefined,
): string | null => {
  if (pageId != null) {
    return toPermalinkMdUrl(pageId);
  }
  if (pathname != null && pathname.length > 0) {
    return toPathMdUrl(pathname);
  }
  return null;
};

/**
 * Format an RFC 8288 "Link" response header value pointing at the page's
 * Markdown alternate: `<{mdUrl}>; rel="alternate"; type="text/markdown"`
 * (Requirement 6.2).
 */
export const toMarkdownAlternateLinkHeader = (mdUrl: string): string => {
  return `<${mdUrl}>; rel="alternate"; type="text/markdown"`;
};
