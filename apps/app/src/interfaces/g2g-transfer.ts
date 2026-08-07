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
  /**
   * The collections the destination could not import, when there were any.
   *
   * The source and the destination are separate processes, and the progress events are
   * emitted by the source, so the only way this fact crosses over is the destination's
   * response to the archive — which is what the source reads to fill this in.
   */
  failedCollections?: readonly string[];
}
