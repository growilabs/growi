/** Storage observability data returned by GET /internal/storage-stats on vault-manager. */
export interface StorageStatsResponse {
  readonly namespaceCount: number;
  readonly totalCommitCount: number;
  readonly looseObjectCount: number;
  readonly repoSizeBytes: number;
  /** ISO 8601 timestamp of the last squash operation, or null if never run. */
  readonly lastSquashAt: string | null;
  /** ISO 8601 timestamp of the last GC operation, or null if never run. */
  readonly lastGcAt: string | null;
}
