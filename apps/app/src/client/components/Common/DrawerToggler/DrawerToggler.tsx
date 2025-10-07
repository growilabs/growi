import { type ReactNode, type JSX } from 'react';

import { useDrawerOpened } from '~/states/ui/sidebar';

import styles from './DrawerToggler.module.scss';

const moduleClass = styles['grw-drawer-toggler'];


type Props = {
  className?: string,
  children?: ReactNode,
}

export const DrawerToggler = (props: Props): JSX.Element => {

  const { className, children } = props;

  const [isOpened, setIsOpened] = useDrawerOpened();

  return (
    <div className={`${moduleClass} ${className ?? ''}`}>
      <button
        className="btn d-flex align-items-center border-0"
        type="button"
        aria-expanded="false"
        aria-label="Toggle navigation"
        onClick={() => setIsOpened(!isOpened)}
      >
        {children}
      </button>
    </div>
  );

};
