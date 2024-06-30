import {
  type FC,
  memo, useCallback, useEffect, useState,
  useRef,
} from 'react';

import withLoadingProps from 'next-dynamic-loading-props';
import dynamic from 'next/dynamic';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';

import { SidebarMode } from '~/interfaces/ui';
import { useIsSearchPage } from '~/stores-universal/context';
import {
  useDrawerOpened,
  useCollapsedContentsOpened,
  useCurrentProductNavWidth,
  usePreferCollapsedMode,
  useSidebarMode,
  useSidebarScrollerRef,
} from '~/stores/ui';

import { DrawerToggler } from '../Common/DrawerToggler';

import { AppTitleOnSidebarHead, AppTitleOnSubnavigation } from './AppTitle/AppTitle';
import { ResizableAreaFallback } from './ResizableArea/ResizableAreaFallback';
import type { ResizableAreaProps } from './ResizableArea/props';
import { SidebarHead } from './SidebarHead';
import { SidebarNav, type SidebarNavProps } from './SidebarNav';

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
  const { mutate: mutateDrawerOpened } = useDrawerOpened();
  const { data: currentProductNavWidth, mutateAndSave: mutateProductNavWidth } = useCurrentProductNavWidth();
  const { mutateAndSave: mutatePreferCollapsedMode } = usePreferCollapsedMode();
  const { mutate: mutateCollapsedContentsOpened } = useCollapsedContentsOpened();

  const [isClient, setClient] = useState(false);
  const [resizableAreaWidth, setResizableAreaWidth] = useState<number|undefined>(
    getWidthByMode(isDrawerMode(), isCollapsedMode(), currentProductNavWidth),
  );

  const resizeHandler = useCallback((newWidth: number) => {
    setResizableAreaWidth(newWidth);
  }, []);

  const resizeDoneHandler = useCallback((newWidth: number) => {
    mutateProductNavWidth(newWidth, false);
  }, [mutateProductNavWidth]);

  const collapsedByResizableAreaHandler = useCallback(() => {
    mutatePreferCollapsedMode(true);
    mutateCollapsedContentsOpened(false);
  }, [mutateCollapsedContentsOpened, mutatePreferCollapsedMode]);

  useIsomorphicLayoutEffect(() => {
    setClient(true);
  }, []);

  // open/close resizable container when drawer mode
  useEffect(() => {
    setResizableAreaWidth(getWidthByMode(isDrawerMode(), isCollapsedMode(), currentProductNavWidth));
    mutateDrawerOpened(false);
  }, [currentProductNavWidth, isCollapsedMode, isDrawerMode, mutateDrawerOpened]);

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
  const { data: currentProductNavWidth } = useCurrentProductNavWidth();
  const { data: isCollapsedContentsOpened, mutate: mutateCollapsedContentsOpened } = useCollapsedContentsOpened();

  const sidebarScrollerRef = useRef<HTMLDivElement>(null);
  const { mutate: mutateSidebarScroller } = useSidebarScrollerRef();
  mutateSidebarScroller(sidebarScrollerRef);


  // open menu when collapsed mode
  const primaryItemHoverHandler = useCallback(() => {
    // reject other than collapsed mode
    if (!isCollapsedMode()) {
      return;
    }

    mutateCollapsedContentsOpened(true);
  }, [isCollapsedMode, mutateCollapsedContentsOpened]);

  // close menu when collapsed mode
  const mouseLeaveHandler = useCallback(() => {
    // reject other than collapsed mode
    if (!isCollapsedMode()) {
      return;
    }

    mutateCollapsedContentsOpened(false);
  }, [isCollapsedMode, mutateCollapsedContentsOpened]);

  const closedClass = isCollapsedMode() && !isCollapsedContentsOpened ? 'd-none' : '';
  const openedClass = isCollapsedMode() && isCollapsedContentsOpened ? 'open' : '';
  const collapsibleContentsWidth = isCollapsedMode() ? currentProductNavWidth : undefined;

  return (
    <div className={`flex-expand-horiz ${className}`} onMouseLeave={mouseLeaveHandler}>
      <Nav onPrimaryItemHover={primaryItemHoverHandler} />
      <div
        ref={sidebarScrollerRef}
        className={`sidebar-contents-container flex-grow-1 overflow-y-auto overflow-x-hidden ${closedClass} ${openedClass}`}
        style={{ width: collapsibleContentsWidth }}
      >
        {children}
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

  const { data: isDrawerOpened, mutate } = useDrawerOpened();

  const openClass = `${isDrawerOpened ? 'open' : ''}`;

  return (
    <>
      <div {...divProps} className={`${className} ${openClass}`}>
        {children}
      </div>
      { isDrawerOpened && (
        <div className="modal-backdrop fade show" onClick={() => mutate(false)} />
      ) }
    </>
  );
});


export const Sidebar = (): JSX.Element => {

  const {
    data: sidebarMode,
    isDrawerMode, isCollapsedMode, isDockMode,
  } = useSidebarMode();

  const { data: isSearchPage } = useIsSearchPage();

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
      { sidebarMode != null && isDrawerMode() && (
        <DrawerToggler className="position-fixed d-none d-md-block">
          <span className="material-symbols-outlined">reorder</span>
        </DrawerToggler>
      ) }
      { sidebarMode != null && !isDockMode() && !isSearchPage && <AppTitleOnSubnavigation /> }
      <DrawableContainer className={`${grwSidebarClass} ${modeClass} border-end flex-expand-vh-100`} divProps={{ 'data-testid': 'grw-sidebar' }}>
        <ResizableContainer>
          { sidebarMode != null && !isCollapsedMode() && <AppTitleOnSidebarHead /> }
          <SidebarHead />
          <CollapsibleContainer Nav={SidebarNav} className="border-top">
            <SidebarContents />
          </CollapsibleContainer>
        </ResizableContainer>
      </DrawableContainer>
    </>
  );
};
