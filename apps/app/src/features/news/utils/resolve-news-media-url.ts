import { NEWS_IMAGES_DIRNAME } from '../consts';

/**
 * Grammar for the RAW input path exactly as written in feed Markdown:
 * `images/<filename>` with a forward slash and an allowed extension. Checked
 * before `new URL` so non-canonical forms that WHATWG would normalize into the
 * same URL (`//host/…`, `https:images/x`, `images\x.png`) are rejected up front
 * — they resolve to a safe URL but violate the stated relative-path contract.
 *
 * The directory segment is built from NEWS_IMAGES_DIRNAME (the single source of
 * truth, shared with the resolved-path containment check below) so changing the
 * constant moves both gates together — a hardcoded `images/` here would be left
 * behind and silently drop every image. The constant is a plain path segment.
 */
const RAW_IMAGE_PATH_PATTERN = new RegExp(
  `^${NEWS_IMAGES_DIRNAME}/[A-Za-z0-9][A-Za-z0-9._-]*\\.(png|jpe?g|webp|gif)$`,
);

/**
 * Filename grammar (single segment) re-checked on the RESOLVED pathname as a
 * second gate after the same-origin/containment checks.
 */
const IMAGE_FILENAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif)$/;

/**
 * Resolve a body-Markdown image path against the news feed URL, returning an
 * absolute URL only when it is safe to hotlink, or `null` otherwise.
 *
 * Accepted only when the resolved URL is:
 * - https,
 * - same-origin as the feed,
 * - directly under the feed's `images/` directory (flat; no subdirectory),
 * - a filename matching IMAGE_FILENAME_PATTERN (png/jpg/jpeg/webp/gif),
 * - free of credentials / query / hash / percent-encoding.
 *
 * Same-origin alone is insufficient: GitHub Pages project sites share one
 * origin, so a sibling repository's path would pass an origin check. The
 * directory-prefix check (trailing-slash-inclusive) closes that.
 *
 * Never throws — invalid input returns null so a single bad reference only
 * drops its own image, never the whole item.
 */
export const resolveNewsMediaUrl = (
  imagePath: string,
  feedUrl: string,
): string | null => {
  // Enforce the raw relative-path shape before normalization.
  if (!RAW_IMAGE_PATH_PATTERN.test(imagePath)) return null;

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
  // Percent-encoding could smuggle traversal (`%2e%2e`) past the prefix check
  // on an origin server that decodes before routing.
  if (resolved.pathname.includes('%')) return null;

  // Feed directory with trailing slash, e.g. `/growi-news-feed/`
  const feedDir = feed.pathname.slice(0, feed.pathname.lastIndexOf('/') + 1);
  const imagesPrefix = `${feedDir}${NEWS_IMAGES_DIRNAME}/`;
  if (!resolved.pathname.startsWith(imagesPrefix)) return null;

  // Flat only: the remainder after `images/` must be a single filename
  const filename = resolved.pathname.slice(imagesPrefix.length);
  if (filename.length === 0 || filename.includes('/')) return null;
  if (!IMAGE_FILENAME_PATTERN.test(filename)) return null;

  return resolved.toString();
};
