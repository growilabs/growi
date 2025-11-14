import type React from 'react';
import type { JSX } from 'react';

import type { GetItemProps } from '../interfaces/downshift';

import styles from './SearchMenuItem.module.scss';

type Props = {
  url: string;
  index: number;
  isActive: boolean;
  getItemProps: GetItemProps;
  children: React.ReactNode;
};

export const SearchMenuItem = (props: Props): JSX.Element => {
  const { url, index, isActive, getItemProps, children } = props;

  const itemMenuOptions = getItemProps({
    index,
    item: { url },
    className: `d-flex align-items-center px-2 py-1 text-muted ${isActive ? 'active' : ''}`,
  });

  return (
    <div className={`search-menu-item ${styles['search-menu-item']}`}>
      <li {...itemMenuOptions}>{children}</li>
    </div>
  );
};
