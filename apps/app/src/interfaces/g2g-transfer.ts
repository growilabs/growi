/**
 * G2G transfer progress status master
 */
export const G2G_PROGRESS_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
  SKIPPED: 'SKIPPED',
} as const;

/**
 * G2G transfer progress status
 */
export type G2GProgressStatus =
  (typeof G2G_PROGRESS_STATUS)[keyof typeof G2G_PROGRESS_STATUS];

/**
 * G2G transfer progress
 */
export interface G2GProgress {
  mongo: G2GProgressStatus;
  attachments: G2GProgressStatus;
}
