import { type JSX, memo, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import withLoadingProps from 'next-dynamic-loading-props';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';

import {
  useCollapsedContentsOpened,
  useCurrentProductNavWidth,
  useDrawerOpened,
  useSetPreferCollapsedMode,
  useSidebarMode,
} from '~/states/ui/sidebar';

import type { ResizableAreaProps } from '../Common/ResizableArea';
// Imported directly, not via the barrel, so ResizableArea itself stays in the
// dynamically loaded chunk below
import { ResizableAreaFallback } from '../Common/ResizableArea/ResizableAreaFallback';

const ResizableArea = withLoadingProps<ResizableAreaProps>((useLoadingProps) =>
  dynamic(
    () => import('../Common/ResizableArea').then((mod) => mod.ResizableArea),
    {
      ssr: false,
      loading: () => {
        const { children, ...rest } = useLoadingProps();
        return (
          <ResizableAreaFallback {...rest}>{children}</ResizableAreaFallback>
        );
      },
    },
  ),
);

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

    const [isClient, setClient] = useState(false);
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

    useIsomorphicLayoutEffect(() => {
      setClient(true);
    }, []);

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

    return !isClient ? (
      <ResizableAreaFallback
        className="flex-expand-vert"
        width={resizableAreaWidth}
      >
        {children}
      </ResizableAreaFallback>
    ) : (
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
