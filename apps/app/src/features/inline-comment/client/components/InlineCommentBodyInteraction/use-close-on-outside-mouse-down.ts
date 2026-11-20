import { type MouseEventHandler, useCallback, useEffect, useRef } from 'react';

type CloseOnOutsideMouseDown = {
  /** Spread onto the popover's root element. */
  readonly onMouseDownCapture: MouseEventHandler;
};

/**
 * Closes the popover on a mousedown outside it.
 *
 * "Inside" is the popover's React tree, not only its DOM subtree: UI the popover opens
 * through a portal (the emoji picker modal, tooltips) lives under `document.body`, yet a
 * press on it must not close the popover and unmount the very UI being pressed.
 */
export const useCloseOnOutsideMouseDown = (
  popperElement: HTMLElement | null,
  onClose: () => void,
): CloseOnOutsideMouseDown => {
  // React dispatches at the root and portal containers, i.e. after document's capture
  // listener (which resets this) and before its bubble listener (which reads it).
  const isFromOwnTreeRef = useRef(false);

  const onMouseDownCapture = useCallback<MouseEventHandler>(() => {
    isFromOwnTreeRef.current = true;
  }, []);

  useEffect(() => {
    const resetOrigin = (): void => {
      isFromOwnTreeRef.current = false;
    };

    const handleMouseDown = (event: MouseEvent): void => {
      if (isFromOwnTreeRef.current) {
        return;
      }
      const target = event.target as Node | null;
      if (
        popperElement != null &&
        target != null &&
        popperElement.contains(target)
      ) {
        return;
      }
      // The mention-completion popup (typing "@" in a MentionAwareCommentInput here) is
      // CodeMirror's own DOM under document.body, not part of the React tree.
      if (
        target instanceof Element &&
        target.closest('.cm-tooltip-autocomplete') != null
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
  }, [popperElement, onClose]);

  return { onMouseDownCapture };
};
