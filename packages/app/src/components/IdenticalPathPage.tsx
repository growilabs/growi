import React, {
  FC,
} from 'react';
import { useTranslation } from 'react-i18next';

import { DevidedPagePath } from '@growi/core';

import { useCurrentPagePath } from '~/stores/context';

import { PageListItemL } from './PageList/PageListItemL';
import { useSWRxPageInfoForList } from '~/stores/page';
import { IPageHasId, IPageWithMeta } from '~/interfaces/page';


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

  const identicalPageDocument = document.getElementById('identical-path-page');
  const pages = JSON.parse(identicalPageDocument?.getAttribute('data-identical-path-pages') || jsonNull) as IPageHasId[];

  const pageIds = pages.map(page => page._id) as string[];

  const { data: idToPageInfoMap } = useSWRxPageInfoForList(pageIds);

  const { data: currentPath } = useCurrentPagePath();

  return (
    <div className="d-flex flex-column flex-lg-row-reverse">

      <div className="grw-side-contents-container">
        <div className="grw-side-contents-sticky-container">
          <div className="border-bottom pb-1">
            {/* <PageAccessories isNotFoundPage={!isPageExist} /> */}
          </div>
        </div>
      </div>

      <div className="flex-grow-1 flex-basis-0 mw-0">

        <IdenticalPathAlert path={currentPath} />

        <div className="page-list">
          <ul className="page-list-ul list-group-flush">
            {pages.map((page) => {
              const pageId = page._id;
              const pageInfo = (idToPageInfoMap ?? {})[pageId];

              const pageWithMeta: IPageWithMeta = {
                pageData: page,
                pageMeta: pageInfo,
              };

              return (
                <PageListItemL
                  key={pageId}
                  page={pageWithMeta}
                  isSelected={false}
                  isChecked={false}
                  isEnableActions
                  showPageUpdatedTime
                // Todo: add onClickDeleteButton when delete feature implemented
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
