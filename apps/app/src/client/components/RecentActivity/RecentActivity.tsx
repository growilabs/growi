import React, { type JSX, useCallback, useEffect, useState } from 'react';

import { toastError } from '~/client/util/toastr';
import { useSWRxRecentActivity } from '~/stores/recent-activity';
import loggerFactory from '~/utils/logger';

import PaginationWrapper from '../PaginationWrapper';
import { ActivityListItem } from './ActivityListItem';

const logger = loggerFactory('growi:RecentActivity');

type RecentActivityProps = {
  userId: string;
};

export const RecentActivity = (props: RecentActivityProps): JSX.Element => {
  const { userId } = props;

  const [activePage, setActivePage] = useState(1);
  const [limit] = useState(10);
  const [offset, setOffset] = useState(0);

  const { data: paginatedData, error } = useSWRxRecentActivity(
    limit,
    offset,
    userId,
  );

  const handlePage = useCallback(
    async (selectedPage: number) => {
      const newOffset = (selectedPage - 1) * limit;

      setOffset(newOffset);
      setActivePage(selectedPage);
    },
    [limit],
  );

  useEffect(() => {
    if (error) {
      logger.error({ err: error }, 'Failed to fetch recent activity data');
      toastError(error);
    }
  }, [error]);

  const activities = paginatedData?.docs ?? [];

  const totalItemsCount = paginatedData?.totalDocs || 0;
  const needsPagination = totalItemsCount > limit;

  return (
    <div className="page-list-container-activity">
      <ul className="page-list-ul page-list-ul-flat mb-3">
        {activities.map((activity) => (
          <li key={`recent-activity-view:${activity._id}`} className="mt-4">
            <ActivityListItem props={{ activity }} />
          </li>
        ))}
      </ul>

      {needsPagination && (
        <PaginationWrapper
          activePage={activePage}
          changePage={handlePage}
          totalItemsCount={totalItemsCount}
          pagingLimit={limit}
          align="center"
          size="sm"
        />
      )}
    </div>
  );
};
