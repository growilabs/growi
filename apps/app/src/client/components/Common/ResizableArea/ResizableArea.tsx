import { type JSX, memo, useCallback, useRef } from 'react';

import { computeWidthFromPointer, isCollapseGesture } from './compute-width';
import type { ResizableAreaProps } from './props';
import { getViewportWidth } from './viewport';

import styles from './ResizableArea.module.scss';

export const ResizableArea = memo((props: ResizableAreaProps): JSX.Element => {
  const {
    className,
    width,
    minWidth = 0,
    maxWidth,
    anchor = 'left',
    disabled,
    children,
    onResize,
    onResizeDone,
    onCollapsed,
  } = props;

  const resizableContainer = useRef<HTMLDivElement>(null);
  // Width reported by the last mousemove; null until the pointer has moved.
  const draggedWidth = useRef<number | null>(null);

  const draggableAreaMoveHandler = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();

      const newWidth = computeWidthFromPointer({
        anchor,
        pointerX: event.clientX,
        viewportWidth: getViewportWidth(),
        minWidth,
        maxWidth,
      });
      draggedWidth.current = newWidth;
      onResize?.(newWidth);
      resizableContainer.current?.classList.add('dragging');
    },
    [anchor, maxWidth, minWidth, onResize],
  );

  const dragableAreaMouseUpHandler = useCallback(
    (event: MouseEvent) => {
      const shouldCollapse =
        onCollapsed != null &&
        isCollapseGesture({
          anchor,
          pointerX: event.clientX,
          viewportWidth: getViewportWidth(),
          minWidth,
        });

      if (shouldCollapse) {
        onCollapsed();
      } else if (draggedWidth.current != null) {
        onResizeDone?.(draggedWidth.current);
      }

      draggedWidth.current = null;
      resizableContainer.current?.classList.remove('dragging');
    },
    [anchor, minWidth, onCollapsed, onResizeDone],
  );

  const dragableAreaMouseDownHandler = useCallback(
    (event: React.MouseEvent) => {
      if (disabled) {
        return;
      }

      event.preventDefault();
      draggedWidth.current = null;

      const removeEventListeners = () => {
        document.removeEventListener('mousemove', draggableAreaMoveHandler);
        document.removeEventListener('mouseup', dragableAreaMouseUpHandler);
        document.removeEventListener('mouseup', removeEventListeners);
      };

      document.addEventListener('mousemove', draggableAreaMoveHandler);
      document.addEventListener('mouseup', dragableAreaMouseUpHandler);
      document.addEventListener('mouseup', removeEventListeners);
    },
    [dragableAreaMouseUpHandler, draggableAreaMoveHandler, disabled],
  );

  const draggableClass =
    anchor === 'right'
      ? `${styles['grw-navigation-draggable']} ${styles['grw-navigation-draggable-right']}`
      : styles['grw-navigation-draggable'];

  return (
    <>
      <div
        ref={resizableContainer}
        className={`${styles['grw-resizable-area']} ${className}`}
        style={{ width }}
      >
        {children}
      </div>
      <div className={draggableClass}>
        {!disabled && (
          <>
            <button
              type="button"
              className="grw-navigation-draggable-hitarea"
              aria-label="Resize sidebar"
              onMouseDown={dragableAreaMouseDownHandler}
            />
            <div className="grw-navigation-draggable-line"></div>
          </>
        )}
      </div>
    </>
  );
});
