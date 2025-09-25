import type { ReactNode, JSX } from 'react';

import { useDrag, useDrop } from 'react-dnd';

import type { DragItemDataType } from '~/interfaces/bookmark-info';

type DragAndDropWrapperProps = {
  item?: Partial<DragItemDataType>
  type: string[]
  children: ReactNode
  useDragMode?: boolean
  useDropMode?: boolean
  onDropItem?:(item: DragItemDataType, type: string | null | symbol) => Promise<void>
  isDropable?:(item: Partial<DragItemDataType>, type: string | null | symbol) => boolean
}

export const DragAndDropWrapper = (props: DragAndDropWrapperProps): JSX.Element => {
  const {
    item, children, useDragMode, useDropMode, type, onDropItem, isDropable,
  } = props;


  const acceptedTypes = type;
  const sourcetype: string | symbol = type[0];


  const [, dragRef] = useDrag({
    type: sourcetype,
    item,
    collect: monitor => ({
      isDragging: monitor.isDragging(),
      canDrag: monitor.canDrag(),
    }),
  });

  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: acceptedTypes,
    drop: (item: DragItemDataType, monitor) => {
      const itemType: string | null | symbol = monitor.getItemType();
      if (onDropItem != null) {
        onDropItem(item, itemType);
      }
    },
    canDrop: (item, monitor) => {
      const itemType: string | null | symbol = monitor.getItemType();
      if (isDropable != null) {
        return isDropable(item, itemType);
      }
      return false;
    },
    collect: monitor => ({
      isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
    }),
  }));

  const getCallback = (c: HTMLDivElement | null) => {
    if (useDragMode && useDropMode) {
      dragRef(c);
      dropRef(c);
    }
    else if (useDragMode) {
      dragRef(c);
    }
    else if (useDropMode) {
      dropRef(c);
    }
  };

  return (
    <div ref={getCallback} className={`grw-drag-drop-container ${isOver ? 'grw-accept-drop-item' : ''}`}>
      {children}
    </div>
  );
};
