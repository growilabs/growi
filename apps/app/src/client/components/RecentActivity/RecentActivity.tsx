import React, {
  useState, useCallback, useEffect, type JSX,
} from 'react';

import type { IPageHasId } from '@growi/core';

import { toastError } from '~/client/util/toastr';
import type { IActivityHasId } from '~/interfaces/activity';
import { useSWRxRecentActivity } from '~/stores/recent-activity';
import loggerFactory from '~/utils/logger';

import PaginationWrapper from '../PaginationWrapper';

const logger = loggerFactory('growi:RecentActivity');

type ActivityWithPageTarget = IActivityHasId & { target: IPageHasId };

const hasPageTarget = (activity: IActivityHasId): activity is ActivityWithPageTarget => {
  return activity.target != null
        && typeof activity.target === 'object'
        && '_id' in activity.target;
};

export const RecentActivity = (): JSX.Element => {

  const [activities, setActivities] = useState<IActivityHasId[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [limit] = useState(10);
  const [offset, setOffset] = useState(0);

  const { data: paginatedData, error, isLoading } = useSWRxRecentActivity(limit, offset);


  const handlePage = useCallback(async(selectedPage: number) => {
    const newOffset = (selectedPage - 1) * limit;

    setOffset(newOffset);
    setActivePage(selectedPage);
  }, [limit]);

  useEffect(() => {

    if (error) {
      logger.error('Failed to fetch recent activity data', error);
      toastError(error);
      return;
    }

    if (paginatedData) {
      const activitiesWithPages: IActivityHasId[] = paginatedData.docs
        .filter(hasPageTarget);

      setActivities(activitiesWithPages);
    }
  }, [paginatedData, error]);

  const totalPageCount = paginatedData?.totalDocs || 0;

  return (
    <div className="page-list-container-activity">
      <ul className="page-list-ul page-list-ul-flat mb-3">
        {activities.map(activity => (
          // REMINDER: make ActivityListItem component
          <li key={`recent-activity-view:${activity._id}`} className="mt-4">
            <ActivityListItem activity={activity} />
          </li>
        ))}
      </ul>

      <PaginationWrapper
        activePage={activePage}
        changePage={handlePage}
        totalItemsCount={totalPageCount}
        pagingLimit={limit}
        align="center"
        size="sm"
      />
    </div>
  );

};
