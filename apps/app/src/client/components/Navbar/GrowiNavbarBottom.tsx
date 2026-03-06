import React, { type JSX, useCallback } from 'react';

import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import { useSearchModalActions } from '~/features/search/client/states/modal/search';
import { useIsSearchPage } from '~/states/context';
import { useCurrentPagePath } from '~/states/page';
import { usePageCreateModalActions } from '~/states/ui/modal/page-create';
import { useDrawerOpened } from '~/states/ui/sidebar';

import styles from './GrowiNavbarBottom.module.scss';

export const GrowiNavbarBottom = (): JSX.Element => {
  const [isDrawerOpened, setIsDrawerOpened] = useDrawerOpened();
  const { open: openCreateModal } = usePageCreateModalActions();
  const currentPagePath = useCurrentPagePath();
  const isSearchPage = useIsSearchPage();
  const { open: openSearchModal } = useSearchModalActions();

  const searchButtonClickHandler = useCallback(() => {
    openSearchModal();
  }, [openSearchModal]);

  return (
    <GroundGlassBar
      className={`
      ${styles['grw-navbar-bottom']}
      ${isDrawerOpened ? styles['grw-navbar-bottom-drawer-opened'] : ''}
      d-md-none d-edit-none d-print-none fixed-bottom`}
    >
      <div className="navbar navbar-expand px-4 px-sm-5">
        <ul className="navbar-nav flex-grow-1 d-flex align-items-center justify-content-between">
          <li className="nav-item">
            <button
              type="button"
              className="nav-link btn-lg"
              onClick={() => setIsDrawerOpened(true)}
            >
              <span className="material-symbols-outlined fs-2">reorder</span>
            </button>
          </li>

          <li className="nav-item">
            <button
              type="button"
              className="nav-link btn-lg"
              onClick={() => openCreateModal(currentPagePath || '')}
            >
              <span className="material-symbols-outlined fs-2">edit</span>
            </button>
          </li>

          {!isSearchPage && (
            <li className="nav-item">
              <button
                type="button"
                className="nav-link btn-lg"
                onClick={searchButtonClickHandler}
              >
                <span className="material-symbols-outlined fs-2">search</span>
              </button>
            </li>
          )}

          <li className="nav-item">
            <button
              type="button"
              className="nav-link btn-lg"
              onClick={() => {}}
              aria-label="Notifications"
            >
              <span className="material-symbols-outlined fs-2">
                notifications
              </span>
            </button>
          </li>
        </ul>
      </div>
    </GroundGlassBar>
  );
};
