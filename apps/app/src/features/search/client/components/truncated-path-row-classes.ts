// Bootstrap utility halves of the shared truncated-path row recipe; the SCSS
// halves (min-width / flex-shrink priority) live in `_truncated-path-row.scss`.
// Shared by SearchResultPagePath and SearchResultAncestorPath so the two
// renderers cannot drift apart.

export const ROW_CLASS_NAME =
  'd-flex align-items-baseline overflow-hidden text-nowrap';

export const SEGMENT_CLASS_NAME = 'text-truncate';

// Separators and the ellipsis marker must never shrink or wrap.
export const FIXED_PART_CLASS_NAME = 'flex-shrink-0 text-nowrap';
