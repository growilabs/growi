import { memo } from 'react';

import { Skeleton } from '~/client/components/Skeleton';

import styles from './SkeletonItem.module.scss';

export const SkeletonItem = memo(() => {
  return <Skeleton additionalClass={styles['grw-skeleton-item']} roundedPill />;
});
