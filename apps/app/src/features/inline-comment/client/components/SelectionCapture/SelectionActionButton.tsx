/**
 * Presentation-only "start a comment" action shown next to a text selection
 * (design.md's SelectionActionButton: "「コメントする」ボタンの提示のみを担う"). It owns
 * no state, no positioning, and no selection logic — `SelectionCapture`
 * decides when to render it and `SelectionPopover` decides where. This
 * component's only job is to call `onCommit` once when chosen.
 */

import type { JSX } from 'react';

type SelectionActionButtonProps = {
  /** Called once when the user chooses to start composing a comment. */
  onCommit: () => void;
};

export const SelectionActionButton = (
  props: SelectionActionButtonProps,
): JSX.Element => {
  const { onCommit } = props;

  return (
    <button
      type="button"
      data-testid="selection-action-button"
      onClick={onCommit}
    >
      Comment
    </button>
  );
};
