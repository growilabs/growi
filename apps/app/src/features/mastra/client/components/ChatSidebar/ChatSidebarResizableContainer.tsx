import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  getViewportWidth,
  ResizableArea,
} from '~/client/components/Common/ResizableArea';
import {
  CHAT_SIDEBAR_WIDTH_MIN,
  getChatSidebarMaxWidth,
  useChatSidebarWidth,
} from '~/features/mastra/states';
import { useDeviceLargerThanSm } from '~/states/ui/device';

import styles from './ChatSidebarResizableContainer.module.scss';

const rootClass = styles['grw-chat-sidebar'] ?? '';
const areaClass = styles['grw-chat-sidebar-resizable-area'] ?? '';

type Props = {
  children: ReactNode;
};

const computeMaxWidth = (): number =>
  getChatSidebarMaxWidth(getViewportWidth());

// Follows window resizes; holding the bound rather than the viewport width
// skips re-renders while the bound stays the same (e.g. capped at the maximum)
const useMaxWidth = (): number => {
  const [maxWidth, setMaxWidth] = useState(computeMaxWidth);

  useEffect(() => {
    const handler = () => setMaxWidth(computeMaxWidth());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return maxWidth;
};

export const ChatSidebarResizableContainer = (props: Props): JSX.Element => {
  const { children } = props;

  const [isLargerThanSm] = useDeviceLargerThanSm();
  const [storedWidth, setStoredWidth] = useChatSidebarWidth();
  const [draggingWidth, setDraggingWidth] = useState<number | null>(null);
  const maxWidth = useMaxWidth();

  const resizeHandler = useCallback((newWidth: number) => {
    setDraggingWidth(newWidth);
  }, []);

  const resizeDoneHandler = useCallback(
    (newWidth: number) => {
      setDraggingWidth(null);
      setStoredWidth(newWidth);
    },
    [setStoredWidth],
  );

  // The stored width may exceed what the current viewport allows (saved on a
  // wider screen), so the upper bound is applied on every render, not only
  // while dragging. The stored value itself is left untouched.
  const requestedWidth = draggingWidth ?? storedWidth;
  const width = Math.min(requestedWidth, maxWidth);

  // Below sm the panel is full width (see the module stylesheet) and cannot be resized
  return (
    // The root must not clip overflow: the resize handle sits just outside the
    // panel's left edge, positioned against this fixed root. Content clipping
    // lives on the resizable area instead.
    <div
      className={`tw-root position-fixed top-0 end-0 h-100 border-start bg-body shadow-sm ${rootClass}`}
    >
      <ResizableArea
        anchor="right"
        className={`h-100 overflow-hidden ${areaClass}`}
        width={width}
        minWidth={CHAT_SIDEBAR_WIDTH_MIN}
        maxWidth={maxWidth}
        disabled={!isLargerThanSm}
        onResize={resizeHandler}
        onResizeDone={resizeDoneHandler}
      >
        {children}
      </ResizableArea>
    </div>
  );
};
