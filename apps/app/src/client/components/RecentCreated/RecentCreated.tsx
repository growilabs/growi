import React, {
  useState, useCallback, useEffect, type JSX,
} from 'react';

import type { IPageHasId } from '@growi/core';

import { apiv3Get } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import { PageListItemS } from '../PageList/PageListItemS';
import PaginationWrapper from '../PaginationWrapper';

const logger = loggerFactory('growi:RecentCreated');

type RecentCreatedProps = {
  userId: string,
}

export const RecentCreated = (props: RecentCreatedProps): JSX.Element => {

  const { userId } = props;

  const [pages, setPages] = useState<IPageHasId[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pagingLimit, setPagingLimit] = useState(10);

  const getMyRecentCreatedList = useCallback(async(selectedPage) => {
    const page = selectedPage;

    try {
      const res = await apiv3Get(`/users/${userId}/recent`, { page });
      const { totalCount, pages, limit } = res.data;

      setPages(pages);
      setActivePage(selectedPage);
      setTotalPages(totalCount);
      setPagingLimit(limit);
    }
    catch (error) {
      logger.error('failed to fetch data', error);
      toastError(error);
    }
  }, [userId]);

  useEffect(() => {
    getMyRecentCreatedList(1);
  }, [getMyRecentCreatedList]);

  const handlePage = useCallback(async(selectedPage) => {
    await getMyRecentCreatedList(selectedPage);
  }, [getMyRecentCreatedList]);

  return (
    <div className="page-list-container-create">
      <ul className="page-list-ul page-list-ul-flat mb-3">

        {pages.map(page => (
          <li key={`recent-created:list-view:${page._id}`} className="mt-4">
            <PageListItemS page={page} />
          </li>
        ))}

      </ul>
      <PaginationWrapper
        activePage={activePage}
        changePage={handlePage}
        totalItemsCount={totalPages}
        pagingLimit={pagingLimit}
        align="center"
        size="sm"
      />
    </div>
  );

};
