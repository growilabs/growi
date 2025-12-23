import {
  type FC, memo, useCallback, useEffect, useState, useRef, type JSX,
} from 'react';

import withLoadingProps from 'next-dynamic-loading-props';
import dynamic from 'next/dynamic';
import SimpleBar from 'simplebar-react';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';

import { SidebarMode } from '~/interfaces/ui';
import { useIsSearchPage } from '~/states/context';
import { useDeviceLargerThanXl, useDeviceLargerThanMd } from '~/states/ui/device';
import { EditorMode, useEditorMode } from '~/states/ui/editor';
import {
  useDrawerOpened,
  useSetPreferCollapsedMode,
  useSidebarMode,
  useCollapsedContentsOpened,
  useCurrentProductNavWidth,
  useSetSidebarScrollerRef,
} from '~/states/ui/sidebar';

import { DrawerToggler } from '../Common/DrawerToggler';

import { AppTitleOnSidebarHead, AppTitleOnEditorSidebarHead, AppTitleOnSubnavigation } from './AppTitle/AppTitle';
import { ResizableAreaFallback } from './ResizableArea/ResizableAreaFallback';
import type { ResizableAreaProps } from './ResizableArea/props';
import { SidebarHead } from './SidebarHead';
import { SidebarNav, type SidebarNavProps } from './SidebarNav';

import 'simplebar-react/dist/simplebar.min.css';
import styles from './Sidebar.module.scss';


const SidebarContents = dynamic(() => import('./SidebarContents').then(mod => mod.SidebarContents), { ssr: false });
const ResizableArea = withLoadingProps<ResizableAreaProps>(useLoadingProps => dynamic(
  () => import('./ResizableArea').then(mod => mod.ResizableArea),
  {
    ssr: false,
    loading: () => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { children, ...rest } = useLoadingProps();
      return <ResizableAreaFallback {...rest}>{children}</ResizableAreaFallback>;
    },
  },
));


const resizableAreaMinWidth = 348;
const sidebarNavCollapsedWidth = 48;

const getWidthByMode = (isDrawerMode: boolean, isCollapsedMode: boolean, currentProductNavWidth: number | undefined): number | undefined => {
  if (isDrawerMode) {
    return undefined;
  }
  if (isCollapsedMode) {
    return sidebarNavCollapsedWidth;
  }
  return currentProductNavWidth;
};


type ResizableContainerProps = {
  children?: React.ReactNode,
}

const ResizableContainer = memo((props: ResizableContainerProps): JSX.Element => {

  const { children } = props;

  const { isDrawerMode, isCollapsedMode, isDockMode } = useSidebarMode();
  const [, setIsDrawerOpened] = useDrawerOpened();
  const [currentProductNavWidth, setCurrentProductNavWidth] = useCurrentProductNavWidth();
  const setPreferCollapsedMode = useSetPreferCollapsedMode();
  const [, setCollapsedContentsOpened] = useCollapsedContentsOpened();

  const [isClient, setClient] = useState(false);
  const [resizableAreaWidth, setResizableAreaWidth] = useState<number | undefined>(
    getWidthByMode(isDrawerMode(), isCollapsedMode(), currentProductNavWidth),
  );

  const resizeHandler = useCallback((newWidth: number) => {
    setResizableAreaWidth(newWidth);
  }, []);

  const resizeDoneHandler = useCallback((newWidth: number) => {
    setCurrentProductNavWidth(newWidth);
  }, [setCurrentProductNavWidth]);

  const collapsedByResizableAreaHandler = useCallback(() => {
    setPreferCollapsedMode(true);
    setCollapsedContentsOpened(false);
  }, [setCollapsedContentsOpened, setPreferCollapsedMode]);

  useIsomorphicLayoutEffect(() => {
    setClient(true);
  }, []);

  // open/close resizable container when drawer mode
  useEffect(() => {
    setResizableAreaWidth(getWidthByMode(isDrawerMode(), isCollapsedMode(), currentProductNavWidth));
    setIsDrawerOpened(false);
  }, [currentProductNavWidth, isCollapsedMode, isDrawerMode, setIsDrawerOpened]);

  return !isClient
    ? (
      <ResizableAreaFallback
        className="flex-expand-vert"
        width={resizableAreaWidth}
      >
        {children}
      </ResizableAreaFallback>
    )
    : (
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

});


type CollapsibleContainerProps = {
  Nav: FC<SidebarNavProps>,
  className?: string,
  children?: React.ReactNode,
}

const CollapsibleContainer = memo((props: CollapsibleContainerProps): JSX.Element => {

  const { Nav, className, children } = props;

  const { isCollapsedMode } = useSidebarMode();
  const [currentProductNavWidth] = useCurrentProductNavWidth();
  const [isCollapsedContentsOpened, setCollapsedContentsOpened] = useCollapsedContentsOpened();

  const sidebarScrollerRef = useRef<HTMLDivElement>(null);
  const setSidebarScrollerRef = useSetSidebarScrollerRef();

  // Set the ref once on mount
  useEffect(() => {
    setSidebarScrollerRef(sidebarScrollerRef);
  }, [setSidebarScrollerRef]);


  // open menu when collapsed mode
  const primaryItemHoverHandler = useCallback(() => {
    // reject other than collapsed mode
    if (!isCollapsedMode()) {
      return;
    }

    setCollapsedContentsOpened(true);
  }, [isCollapsedMode, setCollapsedContentsOpened]);

  // close menu when collapsed mode
  const mouseLeaveHandler = useCallback(() => {
    // reject other than collapsed mode
    if (!isCollapsedMode()) {
      return;
    }

    setCollapsedContentsOpened(false);
  }, [isCollapsedMode, setCollapsedContentsOpened]);

  const closedClass = isCollapsedMode() && !isCollapsedContentsOpened ? 'd-none' : '';
  const openedClass = isCollapsedMode() && isCollapsedContentsOpened ? 'open' : '';
  const collapsibleContentsWidth = isCollapsedMode() ? currentProductNavWidth : undefined;

  return (
    <div className={`flex-expand-horiz ${className}`} onMouseLeave={mouseLeaveHandler}>
      <Nav onPrimaryItemHover={primaryItemHoverHandler} />
      <div
        className={`sidebar-contents-container flex-grow-1 overflow-hidden ${closedClass} ${openedClass}`}
      >
        <SimpleBar
          scrollableNodeProps={{ ref: sidebarScrollerRef }}
          className="simple-scrollbar h-100"
          style={{ width: collapsibleContentsWidth }}
          autoHide
        >
          {children}
        </SimpleBar>
      </div>
    </div>
  );

});

// for data-* attributes
type HTMLElementProps = JSX.IntrinsicElements &
  Record<keyof JSX.IntrinsicElements, { [p: `data-${string}`]: string | number }>;

type DrawableContainerProps = {
  divProps?: HTMLElementProps['div'],
  className?: string,
  children?: React.ReactNode,
}

const DrawableContainer = memo((props: DrawableContainerProps): JSX.Element => {

  const { divProps, className, children } = props;

  const [isDrawerOpened, setIsDrawerOpened] = useDrawerOpened();

  const openClass = `${isDrawerOpened ? 'open' : ''}`;

  return (
    <>
      <div {...divProps} className={`${className} ${openClass}`}>
        {children}
      </div>
      {isDrawerOpened && (
        <div className="modal-backdrop fade show" onClick={() => setIsDrawerOpened(false)} />
      )}
    </>
  );
});


export const Sidebar = (): JSX.Element => {

  const {
    sidebarMode,
    isDrawerMode, isCollapsedMode, isDockMode,
  } = useSidebarMode();

  const isSearchPage = useIsSearchPage();
  const { editorMode } = useEditorMode();
  const [isMdSize] = useDeviceLargerThanMd();
  const [isXlSize] = useDeviceLargerThanXl();

  const isEditorMode = editorMode === EditorMode.Editor;
  const shouldHideSiteName = isEditorMode && isXlSize;
  const shouldHideSubnavAppTitle = isEditorMode && isMdSize && (isDrawerMode() || isCollapsedMode());
  const shouldShowEditorSidebarHead = isEditorMode && isXlSize;

  // css styles
  const grwSidebarClass = styles['grw-sidebar'];
  // eslint-disable-next-line no-nested-ternary
  let modeClass;
  switch (sidebarMode) {
    case SidebarMode.DRAWER:
      modeClass = 'grw-sidebar-drawer';
      break;
    case SidebarMode.COLLAPSED:
      modeClass = 'grw-sidebar-collapsed';
      break;
    case SidebarMode.DOCK:
      modeClass = 'grw-sidebar-dock';
      break;
  }

  return (
    <>
      {sidebarMode != null && isDrawerMode() && (
        <DrawerToggler className="position-fixed d-none d-md-block">
          <span className="material-symbols-outlined">reorder</span>
        </DrawerToggler>
      )}
      {sidebarMode != null && !isDockMode() && !isSearchPage && !shouldHideSubnavAppTitle && (
        <AppTitleOnSubnavigation />
      )}
      <DrawableContainer className={`${grwSidebarClass} ${modeClass} border-end flex-expand-vh-100`} divProps={{ 'data-testid': 'grw-sidebar' }}>
        <ResizableContainer>
          {sidebarMode != null && !isCollapsedMode() && (
            <AppTitleOnSidebarHead hideAppTitle={shouldHideSiteName} />
          )}
          {shouldShowEditorSidebarHead ? <AppTitleOnEditorSidebarHead /> : <SidebarHead />}
          <CollapsibleContainer Nav={SidebarNav} className="border-top">
            <SidebarContents />
          </CollapsibleContainer>
        </ResizableContainer>
      </DrawableContainer>
    </>
  );
};
