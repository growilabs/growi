import {
  memo, useCallback, useMemo, type JSX,
} from 'react';

import {
  useCollapsedContentsOpened, usePreferCollapsedMode, useDrawerOpened, useSidebarMode,
} from '~/stores/ui';


import styles from './ToggleCollapseButton.module.scss';


export const ToggleCollapseButton = memo((): JSX.Element => {

  const { isDrawerMode, isCollapsedMode } = useSidebarMode();
  const { data: isDrawerOpened, mutate: mutateDrawerOpened } = useDrawerOpened();
  const { mutateAndSave: mutatePreferCollapsedMode } = usePreferCollapsedMode();
  const { mutate: mutateCollapsedContentsOpened } = useCollapsedContentsOpened();

  const toggleDrawer = useCallback(() => {
    mutateDrawerOpened(!isDrawerOpened);
  }, [isDrawerOpened, mutateDrawerOpened]);

  const toggleCollapsed = useCallback(() => {
    mutatePreferCollapsedMode(!isCollapsedMode());
    mutateCollapsedContentsOpened(false);
  }, [isCollapsedMode, mutateCollapsedContentsOpened, mutatePreferCollapsedMode]);

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
