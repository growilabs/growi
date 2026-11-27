import type { JSX } from 'react';
import { useRef } from 'react';

import { useCanReactToComments } from '../../hooks/use-can-react-to-comments';
import { useCommentReactions } from '../../hooks/use-comment-reactions';
import { focusAddReactionButton } from '../../utils/focus-add-reaction-button';
import { AddReactionButton } from './AddReactionButton';

type CommentReactionHeaderButtonProps = {
  readonly pageId: string;
  readonly commentId: string;
  /** The hosting view is read-only (share-link view, search preview). */
  readonly isReadOnly: boolean;
  /** Placement and reveal rules belong to the hosting header, which passes them in. */
  readonly className?: string;
};

/**
 * The add button for a comment that has no reaction yet, meant for the comment's header.
 * Once a reaction exists, CommentReactionBar carries the add button at the end of its chip row instead.
 */
export const CommentReactionHeaderButton = ({
  pageId,
  commentId,
  isReadOnly,
  className,
}: CommentReactionHeaderButtonProps): JSX.Element | null => {
  const { chips, isUpdating, setReaction } = useCommentReactions(
    pageId,
    commentId,
  );
  const canReact = useCanReactToComments(isReadOnly);
  const rootRef = useRef<HTMLSpanElement>(null);

  if (chips == null || chips.length > 0) {
    return null;
  }

  return (
    <AddReactionButton
      canReact={canReact}
      chipCount={0}
      isUpdating={isUpdating}
      className={className}
      rootRef={rootRef}
      onAdd={async (emoji) => {
        // The button's parent outlives it and scopes the search to this copy of the comment.
        const headerRow = rootRef.current?.parentElement ?? null;
        await setReaction(emoji, true);
        // This button is gone once the first chip appears; hand its focus to the bar's add button.
        requestAnimationFrame(() =>
          focusAddReactionButton(commentId, headerRow),
        );
      }}
    />
  );
};
