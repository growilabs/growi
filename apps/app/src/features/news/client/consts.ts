/**
 * Shared constants for the news feed page and the items that link into it.
 * Keeping the path and the anchor-id scheme in one place ensures the link
 * produced by NewsItem always matches the element id rendered by NewsFeed.
 */

/** Route of the in-app news feed page (reserved system path, see @growi/core page-path-utils). */
export const NEWS_FEED_PATH = '/_news';

/** DOM id for a news item section on the feed page, used as the scroll anchor. */
export const newsItemAnchorId = (id: string): string => `news-${id}`;

/**
 * Items per page, shared by the /_news feed and the sidebar news stream.
 * These MUST use the same value: the sidebar derives the `?page=N` query for
 * /_news from its own SWRInfinite page index, so if the page sizes drift the
 * link points at the wrong page of the full feed.
 */
export const NEWS_PER_PAGE = 10;
