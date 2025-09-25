import React, { type JSX } from 'react';

import { Skeleton } from '~/client/components/Skeleton';

import styles from './RecentChangesSubstance.module.scss';

const SkeletonItem = () => {

  const isSmall = window.localStorage.isRecentChangesSidebarSmall === 'true';

  return (
    <li className={`list-group-item ${styles['list-group-item']} ${isSmall ? 'py-2' : 'py-3'} px-0`}>
      <div className="d-flex w-100">
        <Skeleton additionalClass="rounded-circle picture" roundedPill />
        <div className="flex-grow-1 ms-2">
          <Skeleton additionalClass={`grw-recent-changes-skeleton-small ${styles['grw-recent-changes-skeleton-small']}`} />
          <Skeleton additionalClass={`grw-recent-changes-skeleton-h5 ${styles['grw-recent-changes-skeleton-h5']} ${isSmall ? 'my-0' : 'my-2'}`} />
          <div className="d-flex justify-content-end grw-recent-changes-item-lower pt-1">
            <Skeleton additionalClass={`grw-recent-changes-skeleton-date ${styles['grw-recent-changes-skeleton-date']}`} />
          </div>
        </div>
      </div>
    </li>
  );
};

const RecentChangesContentSkeleton = (): JSX.Element => {

  return (
    <div className="grw-recent-changes py-3">
      <ul className="list-group list-group-flush">
        <SkeletonItem />
        <SkeletonItem />
        <SkeletonItem />
        <li className="list-group-item p-0"></li>
      </ul>
    </div>
  );
};

export default RecentChangesContentSkeleton;
