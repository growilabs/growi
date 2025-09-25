import React, { useMemo, useCallback, type JSX } from 'react';

import type { IPageHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';

import { toastSuccess } from '~/client/util/toastr';
import type { IPagingResult } from '~/interfaces/paging-result';
import { useIsReadOnlyUser, useShowPageLimitationXL } from '~/stores-universal/context';
import { useEmptyTrashModal } from '~/stores/modal';
import { useSWRxPageInfoForList, useSWRxPageList } from '~/stores/page-listing';

import { MenuItemType } from './Common/Dropdown/PageItemControl';
import CustomNavAndContents from './CustomNavigation/CustomNavAndContents';
import type { DescendantsPageListProps } from './DescendantsPageList';
import EmptyTrashButton from './EmptyTrashButton';

const DescendantsPageList = dynamic<DescendantsPageListProps>(() => import('./DescendantsPageList').then(mod => mod.DescendantsPageList), { ssr: false });


const convertToIDataWithMeta = (page) => {
  return { data: page };
};

const useEmptyTrashButton = () => {

  const { t } = useTranslation();
  const { data: limit } = useShowPageLimitationXL();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: pagingResult, mutate: mutatePageLists } = useSWRxPageList('/trash', 1, limit);
  const { open: openEmptyTrashModal } = useEmptyTrashModal();

  const pageIds = pagingResult?.items?.map(page => page._id);
  const { injectTo } = useSWRxPageInfoForList(pageIds, null, true, true);

  const calculateDeletablePages = useCallback((pagingResult?: IPagingResult<IPageHasId>) => {
    if (pagingResult == null) { return undefined }

    const dataWithMetas = pagingResult.items.map(page => convertToIDataWithMeta(page));
    const pageWithMetas = injectTo(dataWithMetas);

    return pageWithMetas.filter(page => page.meta?.isAbleToDeleteCompletely);
  }, [injectTo]);

  const deletablePages = calculateDeletablePages(pagingResult);

  const onEmptiedTrashHandler = useCallback(() => {
    toastSuccess(t('empty_trash'));

    mutatePageLists();
  }, [t, mutatePageLists]);

  const emptyTrashClickHandler = useCallback(() => {
    if (deletablePages == null) { return }
    openEmptyTrashModal(deletablePages, { onEmptiedTrash: onEmptiedTrashHandler, canDeleteAllPages: pagingResult?.totalCount === deletablePages.length });
  }, [deletablePages, onEmptiedTrashHandler, openEmptyTrashModal, pagingResult?.totalCount]);

  const emptyTrashButton = useMemo(() => {
    return <EmptyTrashButton onEmptyTrashButtonClick={emptyTrashClickHandler} disableEmptyButton={deletablePages?.length === 0 || !!isReadOnlyUser} />;
  }, [emptyTrashClickHandler, deletablePages?.length, isReadOnlyUser]);

  return emptyTrashButton;
};

const DescendantsPageListForTrash = (): JSX.Element => {
  const { data: limit } = useShowPageLimitationXL();

  return (
    <DescendantsPageList
      path="/trash"
      limit={limit}
      forceHideMenuItems={[MenuItemType.RENAME]}
    />
  );
};

export const TrashPageList = (): JSX.Element => {
  const { t } = useTranslation();
  const emptyTrashButton = useEmptyTrashButton();

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: () => <span className="material-symbols-outlined">subject</span>,
        Content: DescendantsPageListForTrash,
        i18n: t('page_list'),
      },
    };
  }, [t]);

  return (
    <div data-testid="trash-page-list" className="mt-5 d-edit-none">
      <CustomNavAndContents navTabMapping={navTabMapping} navRightElement={emptyTrashButton} />
    </div>
  );
};

TrashPageList.displayName = 'TrashPageList';
