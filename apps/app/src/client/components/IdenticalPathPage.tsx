import type { FC, JSX } from 'react';
import React from 'react';

import { DevidedPagePath } from '@growi/core/dist/models';
import { useTranslation } from 'next-i18next';

import { useCurrentPathname } from '~/states/global';
import { useSWRxPageInfoForList, useSWRxPagesByPath } from '~/stores/page-listing';

import { PageListItemL } from './PageList/PageListItemL';


import styles from './IdenticalPathPage.module.scss';


type IdenticalPathAlertProps = {
  path? : string | null,
}

const IdenticalPathAlert : FC<IdenticalPathAlertProps> = (props: IdenticalPathAlertProps) => {
  const { path } = props;
  const { t } = useTranslation();

  let _path = '――';
  let _pageName = '――';

  if (path != null) {
    const devidedPath = new DevidedPagePath(path);
    _path = devidedPath.isFormerRoot ? '/' : devidedPath.former;
    _pageName = devidedPath.latter;
  }


  return (
    <div className="alert alert-warning py-3">
      <h5 className="fw-bold mt-1">{t('duplicated_page_alert.same_page_name_exists', { pageName: _pageName })}</h5>
      <p>
        {t('duplicated_page_alert.same_page_name_exists_at_path',
          { path: _path, pageName: _pageName })}<br />
        <span
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: t('See_more_detail_on_new_schema', { title: t('GROWI.5.0_new_schema') }) }}
        />
      </p>
      <p className="mb-1">{t('duplicated_page_alert.select_page_to_see')}</p>
    </div>
  );
};


export const IdenticalPathPage = (): JSX.Element => {

  const currentPath = useCurrentPathname();

  const { data: pages } = useSWRxPagesByPath(currentPath);
  const { injectTo } = useSWRxPageInfoForList(null, currentPath, true, true);

  if (pages == null) {
    return <></>;
  }

  const injectedPages = injectTo(pages);

  return (
    <>
      <IdenticalPathAlert path={currentPath} />

      <div className={`page-list ${styles['page-list']}`}>
        <ul className="page-list-ul list-group list-group-flush">
          {injectedPages.map((pageWithMeta) => {
            const pageId = pageWithMeta.data._id;

            return (
              <PageListItemL
                key={pageId}
                page={pageWithMeta}
                isSelected={false}
                isEnableActions
                isReadOnlyUser={false}
                showPageUpdatedTime
              />
            );
          })}
        </ul>
      </div>

    </>
  );
};
