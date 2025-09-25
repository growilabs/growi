import {
  memo, useCallback, useRef, type JSX,
} from 'react';

import type { ResizableAreaProps } from './props';

import styles from './ResizableArea.module.scss';


export const ResizableArea = memo((props: ResizableAreaProps): JSX.Element => {
  const {
    className,
    width, minWidth = 0,
    disabled, children,
    onResize, onResizeDone, onCollapsed,
  } = props;

  const resizableContainer = useRef<HTMLDivElement>(null);

  const draggableAreaMoveHandler = useCallback((event: MouseEvent) => {
    event.preventDefault();

    const widthByMousePos = event.pageX;

    const newWidth = Math.max(widthByMousePos, minWidth);
    onResize?.(newWidth);
    resizableContainer.current?.classList.add('dragging');
  }, [minWidth, onResize]);

  const dragableAreaMouseUpHandler = useCallback((event: MouseEvent) => {
    if (resizableContainer.current == null) {
      return;
    }

    const widthByMousePos = event.pageX;

    if (widthByMousePos < minWidth / 2) {
      // force collapsed
      onCollapsed?.();
    }
    else {
      const newWidth = resizableContainer.current.clientWidth;
      onResizeDone?.(newWidth);
    }

    resizableContainer.current.classList.remove('dragging');

  }, [minWidth, onCollapsed, onResizeDone]);

  const dragableAreaMouseDownHandler = useCallback((event: React.MouseEvent) => {
    if (disabled) {
      return;
    }

    event.preventDefault();

    const removeEventListeners = () => {
      document.removeEventListener('mousemove', draggableAreaMoveHandler);
      document.removeEventListener('mouseup', dragableAreaMouseUpHandler);
      document.removeEventListener('mouseup', removeEventListeners);
    };

    document.addEventListener('mousemove', draggableAreaMoveHandler);
    document.addEventListener('mouseup', dragableAreaMouseUpHandler);
    document.addEventListener('mouseup', removeEventListeners);

  }, [dragableAreaMouseUpHandler, draggableAreaMoveHandler, disabled]);

  return (
    <>
      <div
        ref={resizableContainer}
        className={`${styles['grw-resizable-area']} ${className}`}
        style={{ width }}
      >
        {children}
      </div>
      <div className={styles['grw-navigation-draggable']}>
        { !disabled && (
          <>
            <div
              className="grw-navigation-draggable-hitarea"
              onMouseDown={dragableAreaMouseDownHandler}
            />
            <div className="grw-navigation-draggable-line"></div>
          </>
        ) }
      </div>
    </>
  );
});
