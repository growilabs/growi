import React, { useCallback, useState, type JSX } from 'react';

import type {
  IDataWithMeta,
  IPageHasId,
  IPageInfoForOperation,
} from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { toastSuccess } from '~/client/util/toastr';
import type { IPagingResult } from '~/interfaces/paging-result';
import type { OnDeletedFunction, OnPutBackedFunction } from '~/interfaces/ui';
import { useIsGuestUser, useIsReadOnlyUser, useIsSharedUser } from '~/states/context';
import {
  mutatePageTree,
  useSWRxPageInfoForList, useSWRxPageList, mutateRecentlyUpdated,
} from '~/stores/page-listing';

import type { ForceHideMenuItems } from './Common/Dropdown/PageItemControl';
import PageList from './PageList/PageList';
import PaginationWrapper from './PaginationWrapper';

type SubstanceProps = {
  pagingResult: IPagingResult<IPageHasId> | undefined,
  activePage: number,
  setActivePage: (activePage: number) => void,
  forceHideMenuItems?: ForceHideMenuItems,
  onPagesDeleted?: OnDeletedFunction,
  onPagePutBacked?: OnPutBackedFunction,
}

const convertToIDataWithMeta = (page: IPageHasId): IDataWithMeta<IPageHasId> => {
  return { data: page };
};

const DescendantsPageListSubstance = (props: SubstanceProps): JSX.Element => {

  const { t } = useTranslation();

  const {
    pagingResult, activePage, setActivePage, forceHideMenuItems, onPagesDeleted, onPagePutBacked,
  } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();

  const pageIds = pagingResult?.items?.map(page => page._id);
  const { injectTo } = useSWRxPageInfoForList(pageIds, null, true, true);

  let pageWithMetas: IDataWithMeta<IPageHasId, IPageInfoForOperation>[] = [];

  // initial data
  if (pagingResult != null) {
    // convert without meta at first
    const dataWithMetas = pagingResult.items.map(page => convertToIDataWithMeta(page));
    // inject data for listing
    pageWithMetas = injectTo(dataWithMetas);
  }

  const pageDeletedHandler: OnDeletedFunction = useCallback((...args) => {
    const path = args[0];
    const isCompletely = args[2];
    if (path == null || isCompletely == null) {
      toastSuccess(t('deleted_page'));
    }
    else {
      toastSuccess(t('deleted_pages_completely', { path }));
    }
    mutateRecentlyUpdated();
    mutatePageTree();
    if (onPagesDeleted != null) {
      onPagesDeleted(...args);
    }
  }, [onPagesDeleted, t]);

  const pagePutBackedHandler: OnPutBackedFunction = useCallback((path) => {
    toastSuccess(t('page_has_been_reverted', { path }));

    mutateRecentlyUpdated();
    mutatePageTree();
    if (onPagePutBacked != null) {
      onPagePutBacked(path);
    }
  }, [onPagePutBacked, t]);

  if (pagingResult == null) {
    return (
      <div className="wiki">
        <div className="text-muted text-center">
          <LoadingSpinner className="me-1 fs-3" />
        </div>
      </div>
    );
  }

  const showPager = pagingResult.totalCount > pagingResult.limit;

  return (
    <>
      <PageList
        pages={pageWithMetas}
        isEnableActions={!isGuestUser}
        isReadOnlyUser={!!isReadOnlyUser}
        forceHideMenuItems={forceHideMenuItems}
        onPagesDeleted={pageDeletedHandler}
        onPagePutBacked={pagePutBackedHandler}
      />

      { showPager && (
        <div className="my-4">
          <PaginationWrapper
            activePage={activePage}
            changePage={selectedPageNumber => setActivePage(selectedPageNumber)}
            totalItemsCount={pagingResult.totalCount}
            pagingLimit={pagingResult.limit}
            align="center"
          />
        </div>
      ) }
    </>
  );
};

export type DescendantsPageListProps = {
  path: string,
  limit?: number,
  forceHideMenuItems?: ForceHideMenuItems,
}

export const DescendantsPageList = (props: DescendantsPageListProps): JSX.Element => {
  const { path, limit, forceHideMenuItems } = props;

  const [activePage, setActivePage] = useState(1);

  const isSharedUser = useIsSharedUser();

  const { data: pagingResult, error, mutate } = useSWRxPageList(isSharedUser ? null : path, activePage, limit);

  if (error != null) {
    return (
      <div className="my-5">
        <div className="text-danger">{error.message}</div>
      </div>
    );
  }

  return (
    <DescendantsPageListSubstance
      pagingResult={pagingResult}
      activePage={activePage}
      setActivePage={setActivePage}
      forceHideMenuItems={forceHideMenuItems}
      onPagesDeleted={() => mutate()}
      onPagePutBacked={() => mutate()}
    />
  );
};
