/**
 * VaultPathMapper
 *
 * Maps GROWI page paths to git-tree file paths in a deterministic,
 * pure-function manner. The same (pagePath, pageId) pair always produces
 * the same filePath, which means the vault can reconstruct any filePath from
 * a page record without a reverse-index collection.
 *
 * Encoding rules (v1 - immutable after first release):
 *  - Windows reserved characters (<>:"/\|?*) -> percent-encoding
 *  - Leading/trailing spaces -> percent-encoding
 *  - Control characters (U+0000-U+001F, U+007F) -> percent-encoding
 *  - Windows reserved filenames (CON, PRN, AUX, NUL, COM0-9, LPT0-9) ->
 *    prepend '_' to that segment
 *  - Pages with uppercase letters -> append '__<first-8-chars-of-pageId>'
 *    suffix to the filename (collision protection on case-insensitive fs)
 *  - Orphan pages (path starts with /trash) -> placed under '_orphaned/'
 *  - All paths receive a '.md' extension
 */
/**
 * Characters that are illegal in Windows filenames.
 * Backslash is also encoded even though GROWI uses forward-slash as separator.
 */
const WINDOWS_RESERVED_CHARS_RE = /[<>:"/\\|?*]/g;
/**
 * Control characters: U+0000-U+001F and U+007F (DEL).
 * Using RegExp constructor to avoid embedding literal control characters in
 * the source file, which linters flag as suspicious.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional - must match and encode control chars
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;
/**
 * Leading or trailing space on a path segment.
 */
const LEADING_TRAILING_SPACE_RE = /^ | $/g;
/**
 * Windows reserved filename stems (case-insensitive).
 * COM0/LPT0 included conservatively alongside COM1-9/LPT1-9.
 */
const WINDOWS_RESERVED_NAMES_RE = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;
/**
 * Characters that encodeURIComponent does NOT encode but which are unsafe
 * on Windows filesystems and must be percent-encoded manually.
 * '*' (asterisk) is a valid URI sub-delimiter so encodeURIComponent leaves
 * it unencoded, but it is illegal in Windows filenames.
 */
const MANUAL_ENCODE_MAP = {
  '*': '%2A',
};
/**
 * Percent-encodes a single character.
 *
 * Falls back to a manual %HH lookup for characters that encodeURIComponent
 * leaves unencoded (e.g. '*').
 */
function percentEncodeChar(ch) {
  return [...ch]
    .map((c) => {
      const manual = MANUAL_ENCODE_MAP[c];
      if (manual !== undefined) {
        return manual;
      }
      return encodeURIComponent(c);
    })
    .join('');
}
/**
 * Encodes a single path segment (one directory or filename component,
 * without any '/' separator) according to the vault encoding rules.
 *
 * Does NOT add the '.md' extension - callers are responsible for that.
 *
 * @param segment - A single component of the page path (no slashes).
 * @returns Encoded segment.
 */
function encodeSegment(segment) {
  let result = segment;
  // 1. Encode Windows reserved characters.
  result = result.replace(WINDOWS_RESERVED_CHARS_RE, (ch) =>
    percentEncodeChar(ch),
  );
  // 2. Encode control characters.
  result = result.replace(CONTROL_CHARS_RE, (ch) => percentEncodeChar(ch));
  // 3. Encode leading/trailing spaces.
  result = result.replace(LEADING_TRAILING_SPACE_RE, (ch) =>
    percentEncodeChar(ch),
  );
  // 4. Prepend '_' to Windows reserved filenames.
  //    Reserved names contain only ASCII letters/digits which are never
  //    encoded by steps 1-3, so the original segment value is safe to test.
  if (WINDOWS_RESERVED_NAMES_RE.test(segment)) {
    result = `_${result}`;
  }
  return result;
}
/**
 * Returns true when the page path contains any uppercase letter.
 * Used to decide whether the pageId suffix is needed for case-insensitive
 * filesystem collision avoidance.
 */
function hasUpperCase(pagePath) {
  return pagePath !== pagePath.toLowerCase();
}
/**
 * Returns true when the page is considered an orphan.
 * Currently defined as: pages whose path is /trash or starts with /trash/.
 */
function isOrphan(pagePath) {
  return pagePath === '/trash' || pagePath.startsWith('/trash/');
}
/**
 * Strips the leading '/' from a GROWI page path and splits it into segments.
 *
 * @param pagePath - GROWI page path (e.g. '/A/B/C').
 * @returns Array of path segments (no empty leading element).
 */
function splitPagePath(pagePath) {
  const normalised = pagePath.startsWith('/') ? pagePath.slice(1) : pagePath;
  return normalised.split('/');
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Maps a GROWI page path to its canonical git-tree filePath.
 *
 * Rules applied (in order):
 *  1. Each path segment is encoded for filesystem safety.
 *  2. If pagePath contains uppercase letters, the last filename component
 *     receives a '__<pageId[0..7]>' suffix before the '.md' extension.
 *  3. '.md' extension is appended to the final filename.
 *  4. Orphan pages (/trash and subtree) are prefixed with '_orphaned/'.
 *
 * This is a pure function: identical inputs always produce identical outputs.
 *
 * @param pagePath - GROWI page path (must start with '/').
 * @param pageId   - Unique page identifier (ObjectId string or similar).
 * @returns Relative filePath for use inside the git tree.
 */
export function map(pagePath, pageId) {
  const segments = splitPagePath(pagePath);
  const encodedSegments = segments.map(encodeSegment);
  // Determine the case-collision suffix.
  const suffix = hasUpperCase(pagePath) ? `__${pageId.slice(0, 8)}` : '';
  // Build the filename: encoded last segment + optional suffix + extension.
  const lastSegment = encodedSegments.pop() ?? '';
  const filename = `${lastSegment}${suffix}.md`;
  const pathParts = [...encodedSegments, filename];
  const relativePath = pathParts.join('/');
  // Orphan pages are relocated under _orphaned/.
  if (isOrphan(pagePath)) {
    return `_orphaned/${relativePath}`;
  }
  return relativePath;
}
/**
 * Maps a GROWI page-path prefix to a directory prefix suitable for use in
 * rename-prefix and grant-change-prefix instructions.
 *
 * Unlike map():
 *  - No '.md' extension is appended.
 *  - No pageId suffix is applied (prefixes are directory-level).
 *
 * This is a pure function: identical inputs always produce identical outputs.
 *
 * @param pagePath - GROWI page path prefix (e.g. '/A/B').
 * @returns Encoded directory prefix (e.g. 'A/B'), without trailing slash.
 */
export function mapPrefix(pagePath) {
  const segments = splitPagePath(pagePath);
  return segments.map(encodeSegment).join('/');
}
//# sourceMappingURL=vault-path-mapper.js.map
