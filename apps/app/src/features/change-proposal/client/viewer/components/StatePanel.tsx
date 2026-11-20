import type { JSX, ReactNode } from 'react';

import { SymbolIcon } from './SymbolIcon';

import styles from './StatePanel.module.scss';

type StatePanelProps = {
  readonly icon: string;
  readonly variant?: 'empty' | 'error';
  readonly role?: 'alert';
  readonly children: ReactNode;
};

export const StatePanel = ({
  icon,
  variant = 'empty',
  role,
  children,
}: StatePanelProps): JSX.Element =>
  variant === 'error' ? (
    <div
      className={`alert alert-danger d-flex align-items-start gap-2 ${styles['error-panel']}`}
      role={role}
    >
      <SymbolIcon name={icon} className={styles['error-icon']} />
      <div>{children}</div>
    </div>
  ) : (
    <div className={styles['empty-panel']} role={role}>
      <SymbolIcon name={icon} className={styles['empty-icon']} />
      <p className="mb-0">{children}</p>
    </div>
  );
