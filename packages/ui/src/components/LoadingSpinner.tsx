import type { ComponentPropsWithoutRef, JSX } from 'react';

import styles from './LoadingSpinner.module.scss';

const moduleClass = styles.spinner ?? '';

export const LoadingSpinner = ({
  className = '',
}: ComponentPropsWithoutRef<'span'>): JSX.Element => (
  <span
    className={`material-symbols-outlined pb-0 ${moduleClass} ${className}`}
  >
    progress_activity
  </span>
);
