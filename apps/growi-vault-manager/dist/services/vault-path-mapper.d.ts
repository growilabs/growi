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
export declare function map(pagePath: string, pageId: string): string;
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
export declare function mapPrefix(pagePath: string): string;
