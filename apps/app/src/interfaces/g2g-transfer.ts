import type {
  TransferBlocker,
  TransferWarning,
} from '~/server/service/g2g-transfer-transferability';

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
 * What the operator on the source side is told about one rescued destination
 * administrator (requirements 4.6, 4.10).
 *
 * Deliberately **not** the re-insertion payload (`RescuedAdmin` / `AdminRescuePlan` in
 * `server/service/import/rescue-admins.ts`): those carry the account's password hash,
 * its `apiToken` and the `tokenHash` of every access token it had. This shape crosses
 * two boundaries that payload must never reach — the receive route's response body
 * (read by the pusher in `server/service/g2g-transfer.ts`) and the `admin:g2gProgress`
 * socket event the browser subscribes to — so it carries only what the operator needs:
 * which name the account ended up with, what had to be dropped, and whether its
 * identifier had to be reassigned (which is what costs it its pre-transfer sessions).
 */
export interface RescuedAdminSummary {
  readonly originalUsername: string;
  readonly rescuedUsername: string;
  readonly emailRemoved: boolean;
  readonly slackMemberIdRemoved: boolean;
  readonly idReassigned: boolean;
}

/** Every administrator a migration transfer rescued on the destination. */
export interface AdminRescueOutcome {
  readonly rescued: readonly RescuedAdminSummary[];
}

/**
 * What the pushing admin is shown before committing to a transfer: how much of the
 * destination a migration transfer would delete, and anything that should give them
 * pause before they confirm (requirement 3.1). Gathering this must not itself change
 * the destination (requirement 3.3) -- every field here comes from a read.
 *
 * `TransferBlocker` and `TransferWarning` carry no secret or personally-identifying
 * data (just discriminated classification data -- see their doc comments in
 * `server/service/g2g-transfer-transferability.ts`), unlike `AdminRescuePlan` above, so
 * this type re-uses them directly rather than projecting to a redacted summary shape.
 */
export interface TransferPreflightResult {
  readonly destinationCounts: {
    readonly users: number;
    readonly userGroups: number;
    readonly pages: number;
  };
  readonly blockers: readonly TransferBlocker[];
  readonly warnings: readonly TransferWarning[];
}

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
  /**
   * Present only when this transfer replaced the destination's `users` collection and
   * rescued at least one administrator (requirement 4.1). Read out of the same response
   * body as {@link G2GProgress.failedCollections}, and for the same reason: the two
   * GROWIs are separate processes and this is the only channel the fact can cross on.
   */
  rescue?: AdminRescueOutcome;
}
