import React, { useCallback, type JSX } from 'react';

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
    <GroundGlassBar className={`
      ${styles['grw-navbar-bottom']}
      ${isDrawerOpened ? styles['grw-navbar-bottom-drawer-opened'] : ''}
      d-md-none d-edit-none d-print-none fixed-bottom`}
    >
      <div className="navbar navbar-expand px-4 px-sm-5">

        <ul className="navbar-nav flex-grow-1 d-flex align-items-center justify-content-between">
          <li className="nav-item">
            <a
              role="button"
              className="nav-link btn-lg"
              onClick={() => setIsDrawerOpened(true)}
            >
              <span className="material-symbols-outlined fs-2">reorder</span>
            </a>
          </li>

          <li className="nav-item">
            <a
              role="button"
              className="nav-link btn-lg"
              onClick={() => openCreateModal(currentPagePath || '')}
            >
              <span className="material-symbols-outlined fs-2">edit</span>
            </a>
          </li>

          {
            !isSearchPage && (
              <li className="nav-item">
                <a
                  role="button"
                  className="nav-link btn-lg"
                  onClick={searchButtonClickHandler}
                >
                  <span className="material-symbols-outlined fs-2">search</span>
                </a>
              </li>
            )
          }

          <li className="nav-item">
            <a
              role="button"
              className="nav-link btn-lg"
              onClick={() => {}}
            >
              <span className="material-symbols-outlined fs-2">notifications</span>
            </a>
          </li>

        </ul>
      </div>

    </GroundGlassBar>
  );
};
