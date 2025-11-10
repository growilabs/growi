import React, {
  memo, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

import { useTranslation } from 'next-i18next';
import { debounce } from 'throttle-debounce';

import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { useCurrentPageId, useCurrentPagePath } from '~/states/page';
import { useSidebarScrollerElem } from '~/states/ui/sidebar';
import {
  mutatePageTree, mutateRecentlyUpdated, useSWRxRootPage, useSWRxV5MigrationStatus,
} from '~/stores/page-listing';
import loggerFactory from '~/utils/logger';

import { ItemsTree } from '../../ItemsTree/ItemsTree';
import { PageTreeItem } from '../PageTreeItem';
import { SidebarHeaderReloadButton } from '../SidebarHeaderReloadButton';

import { PrivateLegacyPagesLink } from './PrivateLegacyPagesLink';

const logger = loggerFactory('growi:cli:PageTreeSubstance');

type HeaderProps = {
  isWipPageShown: boolean,
  onWipPageShownChange?: () => void
}

export const PageTreeHeader = memo(({ isWipPageShown, onWipPageShownChange }: HeaderProps) => {
  const { t } = useTranslation();

  const { mutate: mutateRootPage } = useSWRxRootPage({ suspense: true });
  useSWRxV5MigrationStatus({ suspense: true });

  const mutate = useCallback(() => {
    mutateRootPage();
    mutatePageTree();
    mutateRecentlyUpdated();
  }, [mutateRootPage]);

  return (
    <>
      <SidebarHeaderReloadButton onClick={() => mutate()} />

      <div className="me-1">
        <button
          color="transparent"
          className="btn p-0 border-0"
          type="button"
          data-bs-toggle="dropdown"
          data-bs-auto-close="outside"
          aria-expanded="false"
        >
          <span className="material-symbols-outlined">more_horiz</span>
        </button>

        <ul className="dropdown-menu">
          <li className="dropdown-item" onClick={onWipPageShownChange}>
            <div className="form-check form-switch">
              <input
                className="form-check-input pe-none"
                type="checkbox"
                checked={isWipPageShown}
                onChange={() => { }}
              />
              <label className="form-check-label pe-none">
                {t('sidebar_header.show_wip_page')}
              </label>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
});
PageTreeHeader.displayName = 'PageTreeHeader';


const PageTreeUnavailable = () => {
  const { t } = useTranslation();

  // TODO : improve design
  // Story : https://redmine.weseek.co.jp/issues/83755
  return (
    <div className="mt-5 mx-2 text-center">
      <h3 className="text-gray">{t('v5_page_migration.page_tree_not_avaliable')}</h3>
      <a href="/admin">{t('v5_page_migration.go_to_settings')}</a>
    </div>
  );
};

type PageTreeContentProps = {
  isWipPageShown: boolean,
}

export const PageTreeContent = memo(({ isWipPageShown }: PageTreeContentProps) => {

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const currentPath = useCurrentPagePath();
  const targetId = useCurrentPageId();

  const { data: migrationStatus } = useSWRxV5MigrationStatus({ suspense: true });

  const targetPathOrId = targetId || currentPath;
  const path = currentPath || '/';

  const { data: rootPageResult } = useSWRxRootPage({ suspense: true });
  const sidebarScrollerElem = useSidebarScrollerElem();
  const [isInitialScrollCompleted, setIsInitialScrollCompleted] = useState(false);

  const rootElemRef = useRef<HTMLDivElement>(null);

  // ***************************  Scroll on init ***************************
  const scrollOnInit = useCallback(() => {
    const rootElement = rootElemRef.current;
    const scrollElement = sidebarScrollerElem;

    if (rootElement == null || scrollElement == null) {
      return;
    }

    const scrollTargetElement = rootElement.querySelector<HTMLElement>('[aria-current]');

    if (scrollTargetElement == null) {
      return;
    }

    logger.debug('scrollOnInit has invoked');


    // NOTE: could not use scrollIntoView
    //  https://stackoverflow.com/questions/11039885/scrollintoview-causing-the-whole-page-to-move

    // calculate the center point
    const scrollTop = scrollTargetElement.offsetTop - scrollElement.getBoundingClientRect().height / 2;
    scrollElement.scrollTo({ top: scrollTop });

    setIsInitialScrollCompleted(true);
  }, [sidebarScrollerElem]);

  const scrollOnInitDebounced = useMemo(() => debounce(500, scrollOnInit), [scrollOnInit]);

  useEffect(() => {
    if (isInitialScrollCompleted || rootPageResult == null) {
      return;
    }

    const rootElement = rootElemRef.current as HTMLElement | null;
    if (rootElement == null) {
      return;
    }

    const observerCallback = (mutationRecords: MutationRecord[]) => {
      mutationRecords.forEach(() => scrollOnInitDebounced());
    };

    const observer = new MutationObserver(observerCallback);
    observer.observe(rootElement, { childList: true, subtree: true });

    // first call for the situation that all rendering is complete at this point
    scrollOnInitDebounced();

    return () => {
      observer.disconnect();
    };
  }, [isInitialScrollCompleted, scrollOnInitDebounced, rootPageResult]);
  // *******************************  end  *******************************


  if (!migrationStatus?.isV5Compatible) {
    return <PageTreeUnavailable />;
  }

  /*
   * dependencies
   */
  if (isGuestUser == null) {
    return null;
  }

  return (
    <div ref={rootElemRef} className="pt-4">
      <ItemsTree
        isEnableActions={!isGuestUser}
        isReadOnlyUser={!!isReadOnlyUser}
        isWipPageShown={isWipPageShown}
        targetPath={path}
        targetPathOrId={targetPathOrId}
        CustomTreeItem={PageTreeItem}
      />

      {!isGuestUser && !isReadOnlyUser && migrationStatus?.migratablePagesCount != null && migrationStatus.migratablePagesCount !== 0 && (
        <div className="grw-pagetree-footer border-top mt-4 py-2 w-100">
          <div className="private-legacy-pages-link px-3 py-2">
            <PrivateLegacyPagesLink />
          </div>
        </div>
      )}
    </div>
  );
});

PageTreeContent.displayName = 'PageTreeContent';
