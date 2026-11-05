export type AiUsageReportWindow = {
  /** ISO 8601, echoed back in UTC. */
  readonly since: string;
  readonly weightedUnits: number;
  readonly unweightedTokens: number;
};

export type AiUsageReport = {
  /** Present only when app:growiAppIdForCloud is set. */
  readonly growiAppIdForCloud?: number;
  /** Same order as the requested start times. */
  readonly windows: readonly AiUsageReportWindow[];
  readonly catalog: {
    readonly source: 'bundled' | 'refreshed';
    /** ISO 8601. When the effective catalog's content was fetched from models.dev. */
    readonly contentFetchedAt: string;
  };
};
