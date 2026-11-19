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
