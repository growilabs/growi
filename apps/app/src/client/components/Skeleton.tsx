import type { JSX } from 'react';

import styles from './Skeleton.module.scss';


const moduleClass = styles['grw-skeleton'] ?? '';


type SkeletonProps = {
  additionalClass?: string,
  roundedPill?: boolean,
}

export const Skeleton = (props: SkeletonProps): JSX.Element => {
  const {
    additionalClass, roundedPill,
  } = props;

  return (
    <div className={`${additionalClass ?? ''}`}>
      <div className={`grw-skeleton ${moduleClass} h-100 w-100 ${roundedPill ? 'rounded-pill' : ''}`}></div>
    </div>
  );
};
