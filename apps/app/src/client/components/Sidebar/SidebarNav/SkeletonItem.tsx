import { memo } from 'react';

import { Skeleton } from '~/client/components/Skeleton.js';

import styles from './SkeletonItem.module.scss';

export const SkeletonItem = memo(() => {
  return <Skeleton additionalClass={styles['grw-skeleton-item']} roundedPill />;
});
