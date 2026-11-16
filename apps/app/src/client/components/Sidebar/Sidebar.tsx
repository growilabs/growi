import { type FC, type JSX, memo, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import SimpleBar from 'simplebar-react';

import { SidebarMode } from '~/interfaces/ui';
import { useIsSearchPage } from '~/states/context';
import {
  useDeviceLargerThanMd,
  useDeviceLargerThanXl,
} from '~/states/ui/device';
import { EditorMode, useEditorMode } from '~/states/ui/editor';
import {
  useCollapsedContentsOpened,
  useCurrentProductNavWidth,
  useDrawerOpened,
  useSetSidebarScrollerRef,
  useSidebarMode,
} from '~/states/ui/sidebar';

import { DrawerToggler } from '../Common/DrawerToggler';
import {
  AppTitleOnEditorSidebarHead,
  AppTitleOnSidebarHead,
  AppTitleOnSubnavigation,
} from './AppTitle/AppTitle';
import { ResizableContainer } from './ResizableContainer';
import { SidebarHead } from './SidebarHead';
import { SidebarNav, type SidebarNavProps } from './SidebarNav';

import styles from './Sidebar.module.scss';

const SidebarContents = dynamic(
  () => import('./SidebarContents').then((mod) => mod.SidebarContents),
  { ssr: false },
);

type CollapsibleContainerProps = {
  Nav: FC<SidebarNavProps>;
  className?: string;
  children?: React.ReactNode;
};

const CollapsibleContainer = memo(
  (props: CollapsibleContainerProps): JSX.Element => {
    const { Nav, className, children } = props;

    const { isCollapsedMode } = useSidebarMode();
    const [currentProductNavWidth] = useCurrentProductNavWidth();
    const [isCollapsedContentsOpened, setCollapsedContentsOpened] =
      useCollapsedContentsOpened();

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

    const closedClass =
      isCollapsedMode() && !isCollapsedContentsOpened ? 'd-none' : '';
    const openedClass =
      isCollapsedMode() && isCollapsedContentsOpened ? 'open' : '';
    const collapsibleContentsWidth = isCollapsedMode()
      ? currentProductNavWidth
      : undefined;

    return (
      <fieldset
        className={`flex-expand-horiz border-0 p-0 m-0 ${className}`}
        onMouseLeave={mouseLeaveHandler}
      >
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
      </fieldset>
    );
  },
);

// for data-* attributes
type HTMLElementProps = JSX.IntrinsicElements &
  Record<
    keyof JSX.IntrinsicElements,
    { [p: `data-${string}`]: string | number }
  >;

type DrawableContainerProps = {
  divProps?: HTMLElementProps['div'];
  className?: string;
  children?: React.ReactNode;
};

const DrawableContainer = memo((props: DrawableContainerProps): JSX.Element => {
  const { divProps, className, children } = props;

  const router = useRouter();
  const [isDrawerOpened, setIsDrawerOpened] = useDrawerOpened();

  // Close drawer on route change
  useEffect(() => {
    const handleRouteChange = () => {
      setIsDrawerOpened(false);
    };

    router.events.on('routeChangeStart', handleRouteChange);
    return () => {
      router.events.off('routeChangeStart', handleRouteChange);
    };
  }, [router.events, setIsDrawerOpened]);

  const openClass = `${isDrawerOpened ? 'open' : ''}`;

  return (
    <>
      <div {...divProps} className={`${className} ${openClass}`}>
        {children}
      </div>
      {isDrawerOpened && (
        <button
          type="button"
          className="modal-backdrop fade show"
          onClick={() => setIsDrawerOpened(false)}
        />
      )}
    </>
  );
});

export const Sidebar = (): JSX.Element => {
  const { sidebarMode, isDrawerMode, isCollapsedMode, isDockMode } =
    useSidebarMode();

  const isSearchPage = useIsSearchPage();
  const { editorMode } = useEditorMode();
  const [isMdSize] = useDeviceLargerThanMd();
  const [isXlSize] = useDeviceLargerThanXl();

  const isEditorMode = editorMode === EditorMode.Editor;
  const shouldHideSiteName = isEditorMode && isXlSize;
  const shouldHideSubnavAppTitle =
    isEditorMode && isMdSize && (isDrawerMode() || isCollapsedMode());
  const shouldShowEditorSidebarHead = isEditorMode && isXlSize;

  // css styles
  const grwSidebarClass = styles['grw-sidebar'];
  let modeClass = '';
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
      {sidebarMode != null &&
        !isDockMode() &&
        !isSearchPage &&
        !shouldHideSubnavAppTitle && <AppTitleOnSubnavigation />}
      <DrawableContainer
        className={`${grwSidebarClass} ${modeClass} border-end flex-expand-vh-100`}
        divProps={{ 'data-testid': 'grw-sidebar' }}
      >
        <ResizableContainer>
          {sidebarMode != null && !isCollapsedMode() && (
            <AppTitleOnSidebarHead hideAppTitle={shouldHideSiteName} />
          )}
          {shouldShowEditorSidebarHead ? (
            <AppTitleOnEditorSidebarHead />
          ) : (
            <SidebarHead />
          )}
          <CollapsibleContainer Nav={SidebarNav} className="border-top">
            <SidebarContents />
          </CollapsibleContainer>
        </ResizableContainer>
      </DrawableContainer>
    </>
  );
};
