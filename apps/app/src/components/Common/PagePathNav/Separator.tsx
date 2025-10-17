import type { JSX } from 'react';

import styles from './Separator.module.scss';

export const Separator = ({
  className,
}: {
  className?: string;
}): JSX.Element => (
  <span className={`separator ${className ?? ''} ${styles['grw-mx-02em']}`}>
    /
  </span>
);
