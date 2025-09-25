import React, { type JSX } from 'react';

import type { IPageInfoForEntity, IPageWithMeta } from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import type { OnDeletedFunction, OnPutBackedFunction } from '~/interfaces/ui';

import type { ForceHideMenuItems } from '../Common/Dropdown/PageItemControl';

import { PageListItemL } from './PageListItemL';

import styles from './PageList.module.scss';

type Props<M extends IPageInfoForEntity> = {
  pages: IPageWithMeta<M>[],
  isEnableActions?: boolean,
  isReadOnlyUser: boolean,
  forceHideMenuItems?: ForceHideMenuItems,
  onPagesDeleted?: OnDeletedFunction,
  onPagePutBacked?: OnPutBackedFunction,
}

const PageList = (props: Props<IPageInfoForEntity>): JSX.Element => {
  const { t } = useTranslation();
  const {
    pages, isEnableActions, isReadOnlyUser, forceHideMenuItems, onPagesDeleted, onPagePutBacked,
  } = props;

  if (pages == null) {
    return (
      <div className="wiki">
        <div className="text-muted text-center">
          <LoadingSpinner className="me-1 fs-3" />
        </div>
      </div>
    );
  }

  const pageList = pages.map(page => (
    <PageListItemL
      key={page.data._id}
      page={page}
      isEnableActions={isEnableActions}
      isReadOnlyUser={isReadOnlyUser}
      forceHideMenuItems={forceHideMenuItems}
      onPageDeleted={onPagesDeleted}
      onPagePutBacked={onPagePutBacked}
    />
  ));

  if (pageList.length === 0) {
    return (
      <div className="mt-2">
        <p>{t('custom_navigation.no_pages_under_this_page')}</p>
      </div>
    );
  }

  return (
    <div className={`page-list ${styles['page-list']}`}>
      <ul className="page-list-ul list-group list-group-flush">
        {pageList}
      </ul>
    </div>
  );
};

export default PageList;
