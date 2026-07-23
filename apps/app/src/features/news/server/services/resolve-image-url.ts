/**
 * Resolve a feed-relative image path into an absolute URL, enforcing that the
 * result stays inside the feed's own `images/` directory.
 *
 * Same-origin checking alone is NOT sufficient here: GitHub Pages project
 * sites share a single origin (e.g. growilabs.github.io), so an absolute URL
 * pointing at another repository's site would pass an origin check. Directory
 * containment (trailing-slash-inclusive pathname prefix) closes that hole and
 * also rejects `/growi-news-feed-evil/images/` style sibling-prefix spoofing.
 *
 * The function does not trust upstream zod validation — it is safe standalone:
 * - never throws (invalid input returns null)
 * - https only, no credentials, no query/hash
 * - rejects percent-encoded pathnames (`%2e%2e` could smuggle traversal past
 *   the prefix check if the origin server decodes before routing)
 */
export const resolveNewsImageUrl = (
  imagePath: string,
  feedUrl: string,
): string | null => {
  let feed: URL;
  let resolved: URL;
  try {
    feed = new URL(feedUrl);
    resolved = new URL(imagePath, feed);
  } catch {
    return null;
  }

  if (resolved.protocol !== 'https:') return null;
  if (resolved.username !== '' || resolved.password !== '') return null;
  if (resolved.search !== '' || resolved.hash !== '') return null;
  if (resolved.origin !== feed.origin) return null;
  if (resolved.pathname.includes('%')) return null;

  // Directory of the feed file, with trailing slash (…/growi-news-feed/)
  const feedDir = feed.pathname.slice(0, feed.pathname.lastIndexOf('/') + 1);
  const imagesDir = `${feedDir}images/`;
  if (!resolved.pathname.startsWith(imagesDir)) return null;
  // Must point at a file inside the directory, not the directory itself
  if (resolved.pathname.length <= imagesDir.length) return null;

  return resolved.toString();
};
