// Bootstrap utility halves of the shared truncated-path row recipe; the SCSS
// halves (min-width) live in `_truncated-path-row.scss`.
// Shared by SearchResultPagePath and SearchResultAncestorPath so the two
// renderers cannot drift apart.

// `overflow-hidden` is only the last-resort safety net: fitting is done by
// collapsing ancestors, not by clipping.
export const ROW_CLASS_NAME =
  'd-flex align-items-baseline overflow-hidden text-nowrap';

// The page name is the only part of the row that is character-truncated.
export const PAGE_NAME_CLASS_NAME = 'text-truncate';

// Ancestor segments, separators and the ellipsis marker never shrink or wrap:
// an ancestor is either shown in full or collapsed into the ellipsis.
export const FIXED_PART_CLASS_NAME = 'flex-shrink-0 text-nowrap';
