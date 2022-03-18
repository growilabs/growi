import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { DevidedPagePath } from '@growi/core';

import { IPageHasId } from '~/interfaces/page';
import { useCurrentPagePath, useIsSharedUser } from '~/stores/context';
import { useDescendantsPageListModal } from '~/stores/modal';
import { useSWRxPageInfoForList } from '~/stores/page';

import PageListIcon from './Icons/PageListIcon';
import { PageListItemL } from './PageList/PageListItemL';


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
      <h5 className="font-weight-bold mt-1">{t('duplicated_page_alert.same_page_name_exists', { pageName: _pageName })}</h5>
      <p>
        {t('duplicated_page_alert.same_page_name_exists_at_path',
          { path: _path, pageName: _pageName })}<br />
        <span
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: t('See_more_detail_on_new_schema', { url: t('GROWI.5.0_new_schema') }) }}
        />
      </p>
      <p className="mb-1">{t('duplicated_page_alert.select_page_to_see')}</p>
    </div>
  );
};


type IdenticalPathPageProps= {
  // add props and types here
}


const jsonNull = 'null';

const IdenticalPathPage:FC<IdenticalPathPageProps> = (props: IdenticalPathPageProps) => {
  const { t } = useTranslation();

  const identicalPageDocument = document.getElementById('identical-path-page');
  const pages = JSON.parse(identicalPageDocument?.getAttribute('data-identical-path-pages') || jsonNull) as IPageHasId[];

  const pageIds = pages.map(page => page._id) as string[];


  const { data: currentPath } = useCurrentPagePath();
  const { data: isSharedUser } = useIsSharedUser();

  const { injectTo } = useSWRxPageInfoForList(pageIds, true, true);

  const { open: openDescendantPageListModal } = useDescendantsPageListModal();

  const injectedPages = injectTo(pages);

  return (
    <div className="d-flex flex-column flex-lg-row-reverse">

      <div className="grw-side-contents-container">
        <div className="grw-page-accessories-control pb-1">
          { currentPath != null && !isSharedUser && (
            <button
              type="button"
              className="btn btn-block btn-outline-secondary grw-btn-page-accessories rounded-pill d-flex justify-content-between"
              onClick={() => openDescendantPageListModal(currentPath)}
            >
              <PageListIcon />
              {t('page_list')}
              <span></span> {/* for a count badge */}
            </button>
          ) }
        </div>
      </div>

      <div className="flex-grow-1 flex-basis-0 mw-0">

        <IdenticalPathAlert path={currentPath} />

        <div className="page-list">
          <ul className="page-list-ul list-group list-group-flush">
            {injectedPages.map((pageWithMeta) => {
              const pageId = pageWithMeta.data._id;

              return (
                <PageListItemL
                  key={pageId}
                  page={pageWithMeta}
                  isSelected={false}
                  isEnableActions
                  showPageUpdatedTime
                />
              );
            })}
          </ul>
        </div>

      </div>

    </div>
  );
};

export default IdenticalPathPage;
