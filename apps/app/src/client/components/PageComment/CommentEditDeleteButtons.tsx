import type { JSX } from 'react';

import { NotAvailableIfReadOnlyUserNotAllowedToComment } from '../NotAvailableForReadOnlyUser';

import styles from './CommentEditDeleteButtons.module.scss';

type CommentEditDeleteButtonsProps = {
  /**
   * Prefix for this instance's `data-testid` values, so each caller keeps
   * the testids it already had: `"comment"` yields `comment-edit-button`,
   * `"inline-comment"` yields `inline-comment-edit-button`,
   * `"inline-comment-reply"` yields `inline-comment-reply-edit-button`, and
   * so on for the delete button.
   */
  testIdPrefix: string;
  onClickEditBtn: () => void;
  onClickDeleteBtn: () => void;
};

/**
 * The edit/delete icon-button pair shown for a comment's own author, shared
 * by the normal comment (`CommentControl.tsx`), the inline comment origin
 * (`InlineCommentItem.tsx`), and an inline comment's reply
 * (`InlineCommentReplies.tsx`) -- previously three near-identical hand-written
 * copies of the same two buttons. Renders no wrapper of its own: each caller
 * places these two buttons inside whatever hover-visibility container its
 * own surface uses (`.page-comment-control`'s absolute positioning for a
 * normal comment, `.icon-button-container`'s inline flex row for an inline
 * comment), since that container's positioning genuinely differs per surface.
 *
 * The popover (`InlineCommentPopoverEntry.tsx`) does not use this component:
 * its buttons are always visible rather than hover-revealed, a real
 * behavioral difference, not merely a styling duplicate.
 */
export const CommentEditDeleteButtons = (
  props: CommentEditDeleteButtonsProps,
): JSX.Element => {
  const { testIdPrefix, onClickEditBtn, onClickDeleteBtn } = props;

  return (
    <NotAvailableIfReadOnlyUserNotAllowedToComment>
      <>
        <button
          type="button"
          data-testid={`${testIdPrefix}-edit-button`}
          className={`btn btn-link ${styles['icon-button']}`}
          onClick={onClickEditBtn}
        >
          <span className="material-symbols-outlined">edit</span>
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-delete-button`}
          className={`btn btn-link text-danger ${styles['icon-button']}`}
          onClick={onClickDeleteBtn}
        >
          <span className="material-symbols-outlined">delete</span>
        </button>
      </>
    </NotAvailableIfReadOnlyUserNotAllowedToComment>
  );
};
