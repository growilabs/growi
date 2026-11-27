import { type MouseEventHandler, useCallback, useEffect, useRef } from 'react';

type CloseOnOutsideMouseDown = {
  /** Attach to the root element of the UI that should close. */
  readonly onMouseDownCapture: MouseEventHandler;
};

/**
 * Calls `onClose` on a mousedown outside the UI whose root gets `onMouseDownCapture`.
 * No listener is registered while `onClose` is undefined.
 *
 * "Inside" is that root's React tree, not its DOM subtree: UI it opens through a portal
 * (the emoji picker modal, tooltips) lives under `document.body`, yet a press on it must
 * not close the UI and unmount the very element being pressed.
 */
export const useCloseOnOutsideMouseDown = (
  onClose: (() => void) | undefined,
): CloseOnOutsideMouseDown => {
  // React dispatches at the root and portal containers, i.e. after document's capture
  // listener (which resets this) and before its bubble listener (which reads it).
  const isFromOwnTreeRef = useRef(false);

  const onMouseDownCapture = useCallback<MouseEventHandler>(() => {
    isFromOwnTreeRef.current = true;
  }, []);

  useEffect(() => {
    if (onClose == null) {
      return;
    }

    const resetOrigin = (): void => {
      isFromOwnTreeRef.current = false;
    };

    const handleMouseDown = (event: MouseEvent): void => {
      if (isFromOwnTreeRef.current) {
        return;
      }
      // The mention-completion popup (typing "@" in a MentionAwareCommentInput) is
      // CodeMirror's own DOM under document.body, not part of the React tree.
      if (
        event.target instanceof Element &&
        event.target.closest('.cm-tooltip-autocomplete') != null
      ) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', resetOrigin, true);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', resetOrigin, true);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onClose]);

  return { onMouseDownCapture };
};
