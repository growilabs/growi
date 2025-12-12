import React, {
  memo, useCallback,
} from 'react';

import { useTranslation } from 'next-i18next';

import { ItemsTree } from '~/features/page-tree/components';
import { usePageTreeInformationUpdate } from '~/features/page-tree/states/page-tree-update';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { useCurrentPageId, useCurrentPagePath } from '~/states/page';
import { useSidebarScrollerElem } from '~/states/ui/sidebar';
import {
  mutatePageTree, mutateRecentlyUpdated, useSWRxRootPage, useSWRxV5MigrationStatus,
} from '~/stores/page-listing';
import loggerFactory from '~/utils/logger';

import { PageTreeItem, pageTreeItemSize } from '../PageTreeItem';
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
  const { notifyUpdateAllTrees } = usePageTreeInformationUpdate();

  const mutate = useCallback(() => {
    mutateRootPage();
    mutatePageTree();
    mutateRecentlyUpdated();
    // Notify headless-tree to rebuild with fresh data
    notifyUpdateAllTrees();
  }, [mutateRootPage, notifyUpdateAllTrees]);

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

  const sidebarScrollerElem = useSidebarScrollerElem();

  const estimateTreeItemSize = useCallback(() => pageTreeItemSize, []);

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
    <div className="pt-4">
      <ItemsTree
        enableRenaming
        enableDragAndDrop
        isEnableActions={!isGuestUser}
        isReadOnlyUser={!!isReadOnlyUser}
        isWipPageShown={isWipPageShown}
        targetPath={path}
        targetPathOrId={targetPathOrId}
        CustomTreeItem={PageTreeItem}
        estimateTreeItemSize={estimateTreeItemSize}
        scrollerElem={sidebarScrollerElem}
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
