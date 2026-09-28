/**
 * Caller-side half of `MentionAwareCommentInput`'s controls contract.
 *
 * The input owns the comment text but renders no submit / mention-picker
 * button of its own, so every caller places those buttons itself and drives
 * them through the controls the input reports via `onControlsChange`. This
 * hook holds that state for the caller.
 *
 * Only `canSubmit` is kept in state — it is the sole part that affects
 * rendering (the submit button's `disabled`). `submit` and `insertMention`
 * are kept in a ref and re-exposed as stable callbacks, which is what keeps
 * the handshake from looping: callers pass a fresh `onSubmit` closure on
 * every render, so the input's own submit handler changes identity every
 * render too, and storing the whole controls object in state would make each
 * notification trigger a re-render that triggers the next notification.
 */

import { useCallback, useRef, useState } from 'react';

export type MentionAwareCommentInputControls = {
  /** False while the text is empty/whitespace-only or the caller's own guard is on. */
  canSubmit: boolean;
  submit: () => void;
  insertMention: (username: string) => void;
};

type CommentInputControlsBinding = MentionAwareCommentInputControls & {
  /** Pass to `MentionAwareCommentInput`'s `onControlsChange`. */
  onControlsChange: (controls: MentionAwareCommentInputControls) => void;
};

export const useCommentInputControls = (): CommentInputControlsBinding => {
  const controlsRef = useRef<MentionAwareCommentInputControls | null>(null);
  const [canSubmit, setCanSubmit] = useState(false);

  const onControlsChange = useCallback(
    (controls: MentionAwareCommentInputControls) => {
      controlsRef.current = controls;
      // Same boolean re-set is a no-op re-render in React, so a notification
      // that changes nothing observable ends here.
      setCanSubmit(controls.canSubmit);
    },
    [],
  );

  const submit = useCallback(() => {
    controlsRef.current?.submit();
  }, []);

  const insertMention = useCallback((username: string) => {
    controlsRef.current?.insertMention(username);
  }, []);

  return { canSubmit, submit, insertMention, onControlsChange };
};
