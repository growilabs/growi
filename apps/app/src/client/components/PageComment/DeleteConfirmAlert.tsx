import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import styles from './DeleteConfirmAlert.module.scss';

type DeleteConfirmAlertProps = {
  /**
   * Prefix for this instance's `data-testid` values, so each caller keeps the
   * testids it already had: `"inline-comment"` yields
   * `inline-comment-delete-confirm`, `"comment"` yields
   * `comment-delete-confirm`, and so on for the two buttons.
   */
  testIdPrefix: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * The delete confirmation shown in place of a modal, shared by the normal
 * comment (`Comment.tsx`) and the inline comment (`InlineCommentItem.tsx`)
 * so both ask the same question the same way (design.md:
 * 削除確認UIの共通化).
 *
 * It holds no state and sends no request: the caller owns whether the
 * confirmation is open and what confirming actually does.
 */
export const DeleteConfirmAlert = (
  props: DeleteConfirmAlertProps,
): JSX.Element => {
  const { testIdPrefix, onCancel, onConfirm } = props;

  const { t } = useTranslation();

  return (
    <div
      data-testid={`${testIdPrefix}-delete-confirm`}
      role="alert"
      /* The 3px danger left accent lives in the CSS module rather than in
         `border-start border-3` utilities -- see the module for why (Req 3.4). */
      className={`alert alert-danger d-flex align-items-center gap-2 mb-0 mt-1 ${styles['delete-confirm-alert']}`}
    >
      <span className="material-symbols-outlined">warning</span>
      <span>{t('page_comment.delete_comment')}</span>
      <span className="ms-auto d-flex gap-2">
        <button
          type="button"
          data-testid={`${testIdPrefix}-delete-cancel-button`}
          className="btn btn-sm btn-outline-secondary"
          onClick={onCancel}
        >
          {t('Cancel')}
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-delete-confirm-button`}
          className="btn btn-sm btn-danger"
          onClick={onConfirm}
        >
          {t('Delete')}
        </button>
      </span>
    </div>
  );
};
