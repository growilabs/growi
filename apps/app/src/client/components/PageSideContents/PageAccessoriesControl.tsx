import { type ReactNode, memo, type JSX } from 'react';

import CountBadge from '../Common/CountBadge';


import styles from './PageAccessoriesControl.module.scss';

const moduleClass = styles['btn-page-accessories'];


type Props = {
  className?: string,
  icon: ReactNode,
  label: ReactNode,
  count?: number,
  offset?: number,
  onClick?: () => void,
}

export const PageAccessoriesControl = memo((props: Props): JSX.Element => {
  const {
    icon, label, count, offset,
    className,
    onClick,
  } = props;

  return (
    <button
      type="button"
      className={`btn btn-outline-neutral-secondary ${moduleClass} ${className} rounded-pill py-1 px-lg-3`}
      onClick={onClick}
    >
      <span className="grw-icon d-flex me-lg-2">{icon}</span>
      <span className="grw-labels d-none d-lg-flex">
        {label}
        {/* Do not display CountBadge if '/trash/*': https://github.com/growilabs/growi/pull/7600 */}
        {count != null
          ? <CountBadge count={count} offset={offset} />
          : <div className="px-2"></div>}
      </span>
    </button>
  );
});
