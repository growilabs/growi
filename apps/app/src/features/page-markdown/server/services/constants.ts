/**
 * Maximum number of child/sibling links enumerated in the navigation footer
 * of a Markdown page response.
 *
 * This is the documented Phase 1 default (see design.md "Open Questions").
 * The caller (respondWithPageMarkdown) is responsible for loading at most
 * this many links and passing the accurate totals separately -- this module
 * only declares the shared limit value; enforcement happens where the
 * links are loaded, not in the pure Markdown builder.
 */
export const MARKDOWN_FOOTER_MAX_LINKS = 50;
