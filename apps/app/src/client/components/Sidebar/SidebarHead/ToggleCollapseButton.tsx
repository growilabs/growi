import {
  memo, useCallback, useMemo, type JSX,
} from 'react';

import {
  useDrawerOpened, useSetPreferCollapsedMode, useSidebarMode, useCollapsedContentsOpened,
} from '~/states/ui/sidebar';


import styles from './ToggleCollapseButton.module.scss';


export const ToggleCollapseButton = memo((): JSX.Element => {

  const { isDrawerMode, isCollapsedMode } = useSidebarMode();
  const [isDrawerOpened, setIsDrawerOpened] = useDrawerOpened();
  const setPreferCollapsedMode = useSetPreferCollapsedMode();
  const [, setCollapsedContentsOpened] = useCollapsedContentsOpened();

  const toggleDrawer = useCallback(() => {
    setIsDrawerOpened(!isDrawerOpened);
  }, [isDrawerOpened, setIsDrawerOpened]);

  const toggleCollapsed = useCallback(() => {
    setPreferCollapsedMode(!isCollapsedMode());
    setCollapsedContentsOpened(false);
  }, [isCollapsedMode, setCollapsedContentsOpened, setPreferCollapsedMode]);

  const rotationClass = isCollapsedMode() ? 'rotate180' : '';
  const icon = useMemo(() => {
    if (isCollapsedMode()) {
      return 'keyboard_double_arrow_left';
    }
    return 'first_page';
  }, [isCollapsedMode]);

  return (
    <button
      type="button"
      className={`btn btn-primary ${styles['btn-toggle-collapse']} p-2`}
      onClick={isDrawerMode() ? toggleDrawer : toggleCollapsed}
      data-testid="btn-toggle-collapse"
    >
      <span className={`material-symbols-outlined fs-2 ${rotationClass}`}>{icon}</span>
    </button>
  );
});
