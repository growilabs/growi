// Above the fixed header and sidebars, below the modal backdrop, so modals opened
// from a popover paint over it (see the popover stacking-order decision in
// .kiro/specs/inline-comment/research.md).
export const INLINE_COMMENT_POPOVER_Z_INDEX = 1040;

// Portaled to document.body from an input inside a popover.
export const MENTION_COMPLETION_Z_INDEX = INLINE_COMMENT_POPOVER_Z_INDEX + 1;
