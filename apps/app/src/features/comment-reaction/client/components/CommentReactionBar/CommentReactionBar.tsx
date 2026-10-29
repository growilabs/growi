import type { JSX } from 'react';

import { useCanReactToComments } from '../../hooks/use-can-react-to-comments';
import { useCommentReactions } from '../../hooks/use-comment-reactions';
import { AddReactionButton } from './AddReactionButton';
import { ReactionChip } from './ReactionChip';

import styles from './CommentReactionBar.module.scss';

type CommentReactionBarProps = {
  readonly pageId: string;
  readonly commentId: string;
  /** The hosting view is read-only (share-link view, search preview). */
  readonly isReadOnly: boolean;
};

export const CommentReactionBar = ({
  pageId,
  commentId,
  isReadOnly,
}: CommentReactionBarProps): JSX.Element | null => {
  const { chips, isUpdating, setReaction } = useCommentReactions(
    pageId,
    commentId,
  );
  const canReact = useCanReactToComments(isReadOnly);

  if (chips == null || (chips.length === 0 && !canReact)) {
    return null;
  }

  return (
    <div
      className={
        chips.length === 0
          ? `${styles['reaction-bar']} ${styles['reaction-bar-empty']}`
          : styles['reaction-bar']
      }
    >
      {chips.map((chip) => (
        <ReactionChip
          key={chip.emoji}
          chip={chip}
          canReact={canReact}
          isUpdating={isUpdating}
          onToggle={setReaction}
        />
      ))}
      <AddReactionButton
        canReact={canReact}
        chipCount={chips.length}
        isUpdating={isUpdating}
        onAdd={(emoji) => {
          void setReaction(emoji, true);
        }}
      />
    </div>
  );
};
