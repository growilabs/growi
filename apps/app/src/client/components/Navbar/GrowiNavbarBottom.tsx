import React, { useCallback, type JSX } from 'react';

import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import { useSearchModal } from '~/features/search/client/stores/search';
import { useIsSearchPage } from '~/stores-universal/context';
import { usePageCreateModal } from '~/stores/modal';
import { useCurrentPagePath } from '~/stores/page';
import { useDrawerOpened } from '~/stores/ui';

import styles from './GrowiNavbarBottom.module.scss';


export const GrowiNavbarBottom = (): JSX.Element => {

  const { data: isDrawerOpened, mutate: mutateDrawerOpened } = useDrawerOpened();
  const { open: openCreateModal } = usePageCreateModal();
  const { data: currentPagePath } = useCurrentPagePath();
  const { data: isSearchPage } = useIsSearchPage();
  const { open: openSearchModal } = useSearchModal();

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
              onClick={() => mutateDrawerOpened(true)}
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
