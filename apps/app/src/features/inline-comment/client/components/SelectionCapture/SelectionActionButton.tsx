/**
 * Presentation-only "start a comment" action shown next to a text selection.
 * It owns no state, no positioning, and no selection logic — `SelectionCapture`
 * decides when to render it and `SelectionPopover` decides where. This
 * component's only job is to call `onCommit` once when chosen.
 */

import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './SelectionActionButton.module.scss';

type SelectionActionButtonProps = {
  /** Called once when the user chooses to start composing a comment. */
  onCommit: () => void;
};

export const SelectionActionButton = (
  props: SelectionActionButtonProps,
): JSX.Element => {
  const { onCommit } = props;
  const { t } = useTranslation();

  return (
    <button
      type="button"
      data-testid="selection-action-button"
      className={`btn btn-sm shadow-sm d-inline-flex align-items-center gap-1 ${styles['selection-action-button']}`}
      onClick={onCommit}
    >
      <span className="material-symbols-outlined fs-6">add_comment</span>
      {t('inline_comment.start_comment')}
    </button>
  );
};
