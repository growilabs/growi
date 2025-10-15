import React, {
  useState, useCallback, useEffect, type JSX,
} from 'react';

import { toastError } from '~/client/util/toastr';
import { useSWRxRecentActivity } from '~/stores/recent-activity.ts';
import loggerFactory from '~/utils/logger';


import PaginationWrapper from '../PaginationWrapper';


export const RecentActivity = (): JSX.Element => {
  const [offset, setOffset] = useState(0);
  const limit = 10;

  const handlePage = useCallback(async(selectedPage: number) => {
    const newOffset = (selectedPage - 1) * limit;
    setOffset(newOffset);
  }, [limit]);

  try {
    const { data, error, isLoading } = useSWRxRecentActivity(limit, offset);

  }

  catch (error) {
    // REMINDER: make logger
    logger.error('failed to fetch data', error);
    toastError(error);
  }


  return (
    <div className="page-list-container-activity">
      <PaginationWrapper
        activePage={}
        changePage={handlePage}
        totalItemsCount={}
        pagingLimit={limit}
        align="center"
        size="sm"
      />
    </div>
  );

};
