/**
 * Shared constants for the news feed page and the items that link into it.
 * Keeping the path and the anchor-id scheme in one place ensures the link
 * produced by NewsItem always matches the element id rendered by NewsFeed.
 */

/** Route of the in-app news feed page (reserved system path, see @growi/core page-path-utils). */
export const NEWS_FEED_PATH = '/_news';

/** DOM id for a news item section on the feed page, used as the scroll anchor. */
export const newsItemAnchorId = (id: string): string => `news-${id}`;
