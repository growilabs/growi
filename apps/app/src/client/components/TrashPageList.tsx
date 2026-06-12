import React, { type JSX, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { IPageHasId } from '@growi/core';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { toastSuccess } from '~/client/util/toastr.js';
import type { IPagingResult } from '~/interfaces/paging-result.js';
import { useIsReadOnlyUser } from '~/states/context.js';
import { showPageLimitationXLAtom } from '~/states/server-configurations/index.js';
import { useEmptyTrashModalActions } from '~/states/ui/modal/empty-trash.js';
import { useSWRxPageInfoForList, useSWRxPageList } from '~/stores/page-listing.js';

import { MenuItemType } from './Common/Dropdown/PageItemControl.js';
import CustomNavAndContents from './CustomNavigation/CustomNavAndContents.js';
import type { DescendantsPageListProps } from './DescendantsPageList.js';
import EmptyTrashButton from './EmptyTrashButton.js';

const DescendantsPageList = dynamic<DescendantsPageListProps>(
  () => import('./DescendantsPageList.js').then((mod) => mod.DescendantsPageList),
  { ssr: false },
);

const convertToIDataWithMeta = (page) => {
  return { data: page };
};

const useEmptyTrashButton = () => {
  const { t } = useTranslation();
  const limit = useAtomValue(showPageLimitationXLAtom);
  const isReadOnlyUser = useIsReadOnlyUser();
  const { data: pagingResult, mutate: mutatePageLists } = useSWRxPageList(
    '/trash',
    1,
    limit,
  );
  const { open: openEmptyTrashModal } = useEmptyTrashModalActions();

  const pageIds = pagingResult?.items?.map((page) => page._id);
  const { injectTo } = useSWRxPageInfoForList(pageIds, null, true, true);

  const calculateDeletablePages = useCallback(
    (pagingResult?: IPagingResult<IPageHasId>) => {
      if (pagingResult == null) {
        return undefined;
      }

      const dataWithMetas = pagingResult.items.map((page) =>
        convertToIDataWithMeta(page),
      );
      const pageWithMetas = injectTo(dataWithMetas);

      return pageWithMetas.filter(
        (page) => page.meta?.isAbleToDeleteCompletely,
      );
    },
    [injectTo],
  );

  const deletablePages = calculateDeletablePages(pagingResult);

  const onEmptiedTrashHandler = useCallback(() => {
    toastSuccess(t('empty_trash'));

    mutatePageLists();
  }, [t, mutatePageLists]);

  const emptyTrashClickHandler = useCallback(() => {
    if (deletablePages == null) {
      return;
    }
    openEmptyTrashModal(deletablePages, {
      onEmptiedTrash: onEmptiedTrashHandler,
      canDeleteAllPages: pagingResult?.totalCount === deletablePages.length,
    });
  }, [
    deletablePages,
    onEmptiedTrashHandler,
    openEmptyTrashModal,
    pagingResult?.totalCount,
  ]);

  const emptyTrashButton = useMemo(() => {
    return (
      <EmptyTrashButton
        onEmptyTrashButtonClick={emptyTrashClickHandler}
        disableEmptyButton={deletablePages?.length === 0 || !!isReadOnlyUser}
      />
    );
  }, [emptyTrashClickHandler, deletablePages?.length, isReadOnlyUser]);

  return emptyTrashButton;
};

const DescendantsPageListForTrash = (): JSX.Element => {
  const limit = useAtomValue(showPageLimitationXLAtom);

  return (
    <DescendantsPageList
      path="/trash"
      limit={limit}
      forceHideMenuItems={[MenuItemType.RENAME]}
    />
  );
};

const PageListIcon = () => (
  <span className="material-symbols-outlined">subject</span>
);

export const TrashPageList = (): JSX.Element => {
  const { t } = useTranslation();
  const emptyTrashButton = useEmptyTrashButton();

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: PageListIcon,
        Content: DescendantsPageListForTrash,
        i18n: t('page_list'),
      },
    };
  }, [t]);

  return (
    <div data-testid="trash-page-list" className="d-edit-none">
      <CustomNavAndContents
        navTabMapping={navTabMapping}
        navRightElement={emptyTrashButton}
      />
    </div>
  );
};

TrashPageList.displayName = 'TrashPageList';
