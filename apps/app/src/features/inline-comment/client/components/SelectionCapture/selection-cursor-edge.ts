import type { SelectionEdge } from '../SelectionPopover/selection-virtual-element';

/**
 * Which end of the selected Range the user's cursor (the selection's focus)
 * is at: `start` after a right-to-left / bottom-to-top drag, `end` otherwise.
 * `Range` itself is always start <= end, so the direction has to be read from
 * the Selection's anchor and focus.
 */
export const cursorEdgeOf = (
  selection: Pick<
    Selection,
    'anchorNode' | 'anchorOffset' | 'focusNode' | 'focusOffset'
  >,
): SelectionEdge => {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (anchorNode == null || focusNode == null) {
    return 'end';
  }

  // Per the DOM spec, setting an end that precedes the start collapses the
  // range onto that end, so a collapsed probe means the focus comes first.
  const probe = document.createRange();
  probe.setStart(anchorNode, anchorOffset);
  probe.setEnd(focusNode, focusOffset);
  return probe.collapsed ? 'start' : 'end';
};
