import { useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import type { SidebarContentsType } from '~/interfaces/ui';
import { SidebarMode } from '~/interfaces/ui';
import { useIsMobile } from '~/states/ui/device';
import { useCollapsedContentsOpened, useCurrentSidebarContents } from '~/states/ui/sidebar';

const useIndicator = (sidebarMode: SidebarMode, isSelected: boolean): string => {
  const [isCollapsedContentsOpened] = useCollapsedContentsOpened();

  if (sidebarMode === SidebarMode.COLLAPSED && !isCollapsedContentsOpened) {
    return '';
  }

  return isSelected ? 'active' : '';
};

export type PrimaryItemProps = {
  contents: SidebarContentsType,
  label: string,
  iconName: string,
  sidebarMode: SidebarMode,
  isCustomIcon?: boolean,
  badgeContents?: number,
  onHover?: (contents: SidebarContentsType) => void,
  onClick?: () => void,
}

export const PrimaryItem = (props: PrimaryItemProps): JSX.Element => {
  const {
    contents, label, iconName, sidebarMode, badgeContents, isCustomIcon,
    onClick, onHover,
  } = props;

  const [currentContents, setCurrentContents] = useCurrentSidebarContents();

  const indicatorClass = useIndicator(sidebarMode, contents === currentContents);
  const [isMobile] = useIsMobile();
  const { t } = useTranslation();

  const selectThisItem = useCallback(() => {
    setCurrentContents(contents);
  }, [contents, setCurrentContents]);

  const itemClickedHandler = useCallback(() => {
    // do nothing ONLY WHEN the collapse mode
    if (sidebarMode === SidebarMode.COLLAPSED) {
      return;
    }

    selectThisItem();
    onClick?.();
  }, [onClick, selectThisItem, sidebarMode]);

  const mouseEnteredHandler = useCallback(() => {
    // ignore other than collapsed mode
    if (sidebarMode !== SidebarMode.COLLAPSED) {
      return;
    }

    selectThisItem();
    onHover?.(contents);
  }, [contents, onHover, selectThisItem, sidebarMode]);


  const labelForTestId = label.toLowerCase().replace(' ', '-');

  return (
    <>
      <button
        type="button"
        data-testid={`grw-sidebar-nav-primary-${labelForTestId}`}
        className={`btn btn-primary ${indicatorClass}`}
        onClick={itemClickedHandler}
        onMouseEnter={mouseEnteredHandler}
        id={labelForTestId}
      >
        <div className="position-relative">
          {badgeContents != null && (
            <span className="position-absolute badge rounded-pill bg-primary">{badgeContents}</span>
          )}
          {isCustomIcon
            ? (<span className="growi-custom-icons fs-4 align-middle">{iconName}</span>)
            : (<span className="material-symbols-outlined">{iconName}</span>)
          }
        </div>
      </button>
      {
        isMobile === false ? (
          <UncontrolledTooltip
            autohide
            placement="right"
            target={labelForTestId}
            fade={false}
          >
            {t(label)}
          </UncontrolledTooltip>
        ) : <></>
      }
    </>
  );
};
PrimaryItem.displayName = 'PrimaryItem';
