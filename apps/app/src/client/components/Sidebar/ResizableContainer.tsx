import { type JSX, memo, useCallback, useEffect, useState } from 'react';

import {
  useCollapsedContentsOpened,
  useCurrentProductNavWidth,
  useDrawerOpened,
  useSetPreferCollapsedMode,
  useSidebarMode,
} from '~/states/ui/sidebar';

import { ResizableArea } from '../Common/ResizableArea';

const resizableAreaMinWidth = 348;
const sidebarNavCollapsedWidth = 48;

const getWidthByMode = (
  isDrawerMode: boolean,
  isCollapsedMode: boolean,
  currentProductNavWidth: number | undefined,
): number | undefined => {
  if (isDrawerMode) {
    return undefined;
  }
  if (isCollapsedMode) {
    return sidebarNavCollapsedWidth;
  }
  return currentProductNavWidth;
};

type ResizableContainerProps = {
  children?: React.ReactNode;
};

export const ResizableContainer = memo(
  (props: ResizableContainerProps): JSX.Element => {
    const { children } = props;

    const { isDrawerMode, isCollapsedMode, isDockMode } = useSidebarMode();
    const [, setIsDrawerOpened] = useDrawerOpened();
    const [currentProductNavWidth, setCurrentProductNavWidth] =
      useCurrentProductNavWidth();
    const setPreferCollapsedMode = useSetPreferCollapsedMode();
    const [, setCollapsedContentsOpened] = useCollapsedContentsOpened();

    const [resizableAreaWidth, setResizableAreaWidth] = useState<
      number | undefined
    >(
      getWidthByMode(isDrawerMode(), isCollapsedMode(), currentProductNavWidth),
    );

    const resizeHandler = useCallback((newWidth: number) => {
      setResizableAreaWidth(newWidth);
    }, []);

    const resizeDoneHandler = useCallback(
      (newWidth: number) => {
        setCurrentProductNavWidth(newWidth);
      },
      [setCurrentProductNavWidth],
    );

    const collapsedByResizableAreaHandler = useCallback(() => {
      setPreferCollapsedMode(true);
      setCollapsedContentsOpened(false);
    }, [setCollapsedContentsOpened, setPreferCollapsedMode]);

    // open/close resizable container when drawer mode
    useEffect(() => {
      setResizableAreaWidth(
        getWidthByMode(
          isDrawerMode(),
          isCollapsedMode(),
          currentProductNavWidth,
        ),
      );
      setIsDrawerOpened(false);
    }, [
      currentProductNavWidth,
      isCollapsedMode,
      isDrawerMode,
      setIsDrawerOpened,
    ]);

    return (
      <ResizableArea
        className="flex-expand-vert"
        width={resizableAreaWidth}
        minWidth={resizableAreaMinWidth}
        disabled={!isDockMode()}
        onResize={resizeHandler}
        onResizeDone={resizeDoneHandler}
        onCollapsed={collapsedByResizableAreaHandler}
      >
        {children}
      </ResizableArea>
    );
  },
);
