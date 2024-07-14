import { type ReactNode } from 'react';

import { useDrawerOpened } from '~/stores/ui';


import styles from './DrawerToggler.module.scss';

const moduleClass = styles['grw-drawer-toggler'];


type Props = {
  className?: string,
  children?: ReactNode,
}

export const DrawerToggler = (props: Props): JSX.Element => {

  const { className, children } = props;

  const { data: isOpened, mutate } = useDrawerOpened();

  return (
    <div className={`${moduleClass} ${className ?? ''}`}>
      <button
        className="btn d-flex align-items-center border-0"
        type="button"
        aria-expanded="false"
        aria-label="Toggle navigation"
        onClick={() => mutate(!isOpened)}
      >
        {children}
      </button>
    </div>
  );

};
