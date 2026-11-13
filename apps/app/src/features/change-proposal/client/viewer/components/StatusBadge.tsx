import type { JSX } from 'react';

import { SymbolIcon } from './SymbolIcon';
import type { StatusAppearance, StatusTone } from './status-appearance';

import styles from './StatusBadge.module.scss';

// Bootstrap's subtle/emphasis pairs follow data-bs-theme, so no per-theme colors here.
const TONE_CLASSES = {
  success: 'text-success-emphasis bg-success-subtle border-success-subtle',
  info: 'text-info-emphasis bg-info-subtle border-info-subtle',
  warning: 'text-warning-emphasis bg-warning-subtle border-warning-subtle',
  danger: 'text-danger-emphasis bg-danger-subtle border-danger-subtle',
  neutral: 'text-body-secondary bg-body-tertiary border-secondary-subtle',
} as const satisfies Record<StatusTone, string>;

type StatusBadgeProps = {
  readonly appearance: StatusAppearance;
  readonly label: string;
  readonly size?: 'sm' | 'md';
};

export const StatusBadge = ({
  appearance,
  label,
  size = 'sm',
}: StatusBadgeProps): JSX.Element => (
  <span
    className={`badge rounded-pill border ${styles['status-badge']} ${
      size === 'md' ? styles['status-badge-md'] : ''
    } ${TONE_CLASSES[appearance.tone]}`}
  >
    <SymbolIcon name={appearance.icon} className={styles.icon} />
    {label}
  </span>
);
