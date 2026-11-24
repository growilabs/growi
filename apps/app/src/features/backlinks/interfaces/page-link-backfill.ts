/** The kinds of `requestedScope` an administrator can start the backfill with. */
export const BackfillScopeKind = {
  ALL: 'all',
  MAX_PAGES: 'maxPages',
  SINCE: 'since',
} as const;
export type BackfillScopeKind =
  (typeof BackfillScopeKind)[keyof typeof BackfillScopeKind];

/** Payload of `SocketEventName.BacklinksBackfillProgress` on the admin channel. */
export interface BacklinksBackfillProgressData {
  readonly status: 'running' | 'stopped' | 'complete';
  readonly processed: number;
  readonly runTotal: number;
  readonly skippedPages: number;
}

/** A start scope, generic over how its date travels: a string on the wire, a Date once parsed. */
export type BackfillScopeOf<TDate> =
  | { readonly kind: typeof BackfillScopeKind.ALL }
  | {
      readonly kind: typeof BackfillScopeKind.MAX_PAGES;
      readonly maxPages: number;
    }
  | { readonly kind: typeof BackfillScopeKind.SINCE; readonly since: TDate };

/**
 * Body of `POST /_api/v3/backlinks-backfill/start`: the scope of the run to request; `since` is
 * ISO 8601 and not in the future.
 */
export type BacklinksBackfillStartRequest = BackfillScopeOf<string>;

export type BacklinksBackfillJobStatus =
  | 'idle'
  | 'requested'
  | 'running'
  | 'stopped'
  | 'complete'
  | 'failed';

/** The job state the admin endpoints return; dates are ISO 8601 strings. */
export interface BacklinksBackfillState {
  readonly status: BacklinksBackfillJobStatus;
  readonly stopRequested: boolean;
  /** Pages of the current or last run walked so far, skipped ones included. */
  readonly processed: number;
  /** Pages in the run's range, counted at its first claim; null before that. */
  readonly runTotal: number | null;
  readonly skippedPages: number;
  readonly coverage: 'none' | 'partial' | 'all';
  /** Set exactly when `coverage` is `partial`. */
  readonly coveredSince: string | null;
  readonly completedAt: string | null;
  readonly lastError: string | null;
  /** Pages the walk scans that the coverage does not include yet; computed on read. */
  readonly notIncludedCount: number;
  /** Pages the walk scans (neither trashed nor empty); computed on read. */
  readonly totalPageCount: number;
}
