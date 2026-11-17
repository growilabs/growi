/**
 * Offers "start a comment" on an image the mouse rests on, so an image can be
 * commented without dragging a selection around it. Touch and keyboard focus
 * deliberately do not open it: an image is handled like body text there, and
 * a selection still reaches it the usual way.
 */

import type { JSX, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useIsCommentActionBlockedForReadOnlyUser } from '~/client/components/NotAvailableForReadOnlyUser';

import { isImageInState } from '../../services/image-in-range';
import { isCountedImage } from '../../services/rendered-text';
import { SelectionPopover } from '../SelectionPopover/SelectionPopover';
import { SelectionActionButton } from './SelectionActionButton';

// Long enough for the pointer to travel from the image onto the button.
const HIDE_DELAY_MS = 250;

/**
 * An already-commented image is left out: hovering it opens that comment's
 * preview, and a button there would cover it.
 */
const commentableImageOf = (
  target: EventTarget | null,
  container: HTMLElement,
): HTMLImageElement | null => {
  if (!(target instanceof Element) || !isCountedImage(target, container)) {
    return null;
  }
  return isImageInState(target, 'saved') ? null : target;
};

type HoveredImage = {
  image: HTMLImageElement | null;
  cancelHide: () => void;
  scheduleHide: () => void;
  hide: () => void;
};

const useHoveredImage = (
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): HoveredImage => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setImage(null);
    }, HIDE_DELAY_MS);
  }, [cancelHide]);

  const hide = useCallback(() => {
    cancelHide();
    setImage(null);
  }, [cancelHide]);

  useEffect(() => {
    const container = containerRef.current;
    if (container == null || !enabled) {
      return undefined;
    }

    const handlePointerOver = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        return;
      }
      const hovered = commentableImageOf(event.target, container);
      if (hovered != null) {
        cancelHide();
        setImage(hovered);
      }
    };
    const handlePointerOut = (event: PointerEvent): void => {
      if (commentableImageOf(event.target, container) != null) {
        scheduleHide();
      }
    };

    container.addEventListener('pointerover', handlePointerOver);
    container.addEventListener('pointerout', handlePointerOut);
    return () => {
      container.removeEventListener('pointerover', handlePointerOver);
      container.removeEventListener('pointerout', handlePointerOut);
      cancelHide();
    };
  }, [containerRef, enabled, cancelHide, scheduleHide]);

  useEffect(() => {
    if (image == null) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        hide();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [image, hide]);

  return { image, cancelHide, scheduleHide, hide };
};

type ImageCommentButtonProps = {
  /** The page-body container whose images are offered for commenting. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called with a range holding exactly the chosen image. */
  onCommit: (range: Range) => void;
};

export const ImageCommentButton = (
  props: ImageCommentButtonProps,
): JSX.Element | null => {
  const { containerRef, onCommit } = props;

  const isBlocked = useIsCommentActionBlockedForReadOnlyUser();
  const { image, cancelHide, scheduleHide, hide } = useHoveredImage(
    containerRef,
    !isBlocked,
  );

  const range = useMemo(() => {
    if (image == null) {
      return null;
    }
    const imageRange = document.createRange();
    imageRange.selectNode(image);
    return imageRange;
  }, [image]);

  const commit = useCallback(() => {
    if (range == null) {
      return;
    }
    hide();
    onCommit(range);
  }, [range, hide, onCommit]);

  if (range == null) {
    return null;
  }

  return (
    <SelectionPopover range={range}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: not an interactive element itself — it only keeps the button it wraps open while the pointer is on it */}
      <div
        onPointerEnter={cancelHide}
        onPointerLeave={scheduleHide}
        onMouseDown={(event) => event.preventDefault()}
      >
        <SelectionActionButton onCommit={commit} />
      </div>
    </SelectionPopover>
  );
};
