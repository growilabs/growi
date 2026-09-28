import type { JSX } from 'react';

import { CommentEditDeleteButtons } from './CommentEditDeleteButtons';

type CommentControlProps = {
  onClickEditBtn: () => void;
  onClickDeleteBtn: () => void;
};

export const CommentControl = (props: CommentControlProps): JSX.Element => {
  const { onClickEditBtn, onClickDeleteBtn } = props;

  return (
    // The page-comment-control class is imported from Comment.module.scss
    <div className="page-comment-control">
      <CommentEditDeleteButtons
        testIdPrefix="comment"
        onClickEditBtn={onClickEditBtn}
        onClickDeleteBtn={onClickDeleteBtn}
      />
    </div>
  );
};
