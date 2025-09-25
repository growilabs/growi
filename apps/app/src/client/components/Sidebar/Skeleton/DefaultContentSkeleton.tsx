import React, { type JSX } from 'react';

import { Skeleton } from '~/client/components/Skeleton';

import styles from './DefaultContentSkelton.module.scss';

const DefaultContentSkeleton = (): JSX.Element => {

  return (
    <div className={`py-3 grw-default-content-skelton ${styles['grw-default-content-skelton']}`}>
      <Skeleton additionalClass={`grw-skeleton-text-full ${styles['grw-skeleton-text-full']}`} />
      <Skeleton additionalClass={`grw-skeleton-text-full ${styles['grw-skeleton-text-full']}`} />
      <Skeleton additionalClass={`grw-skeleton-text ${styles['grw-skeleton-text']}`} />
    </div>
  );
};

export default DefaultContentSkeleton;
