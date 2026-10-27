/**
 * Shared constants for the news feature, referenced by BOTH the server
 * (cron ingest) and the client (Markdown media resolution). Kept at the
 * feature root — not under client/ or server/ — so neither side has to import
 * across the client/server boundary to read them.
 */

/**
 * Vendor-controlled news feed URL. Hardcoded so a fresh deployment delivers
 * news without any infrastructure-side env injection. Users (incl. admins)
 * cannot change this; opt-out is performed via the `news:isDeliveryEnabled`
 * config flag managed in the admin UI.
 *
 * The client resolves body Markdown image paths against this URL, so it must
 * stay importable from client code (this module has no server-only imports).
 */
export const FEED_URL = 'https://growilabs.github.io/growi-news-feed/feed.json';

/**
 * Directory (relative to the feed file) that news images must live directly
 * under. Single source of truth for the containment rule in
 * resolveNewsMediaUrl — images are allowed only as `images/<filename>` (flat;
 * no subdirectory).
 */
export const NEWS_IMAGES_DIRNAME = 'images';
