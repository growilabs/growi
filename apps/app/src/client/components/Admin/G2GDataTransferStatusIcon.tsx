import React, { type ComponentPropsWithoutRef, type JSX } from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';

import { G2G_PROGRESS_STATUS, type G2GProgressStatus } from '~/interfaces/g2g-transfer';


/**
 * Props for {@link G2GDataTransferStatusIcon}
 */
interface Props extends ComponentPropsWithoutRef<'span'>{
  status: G2GProgressStatus;
}

/**
 * Icon for G2G transfer status
 */
const G2GDataTransferStatusIcon = ({ status, className, ...props }: Props): JSX.Element => {
  if (status === G2G_PROGRESS_STATUS.IN_PROGRESS) {
    return (
      <LoadingSpinner className={`${className}`} aria-label="in progress" {...props} />
    );
  }

  if (status === G2G_PROGRESS_STATUS.COMPLETED) {
    return (
      <span className={`material-symbols-outlined text-info ${className}`} aria-label="completed" {...props}>check_circle</span>
    );
  }

  if (status === G2G_PROGRESS_STATUS.ERROR) {
    return (
      <span className={`material-symbols-outlined text-danger ${className}`} aria-label="error" {...props}>error</span>
    );
  }

  if (status === G2G_PROGRESS_STATUS.SKIPPED) {
    return (
      <span className={`material-symbols-outlined ${className}`} aria-label="skipped" {...props}>block</span>
    );
  }

  return <span className={`material-symbols-outlined ${className}`} aria-label="pending" {...props}>circle</span>;
};

export default G2GDataTransferStatusIcon;
