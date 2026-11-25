export interface IBacklink {
  pageId: string;
  path: string;
}

export interface IBacklinkResponse {
  backlinks: IBacklink[];
  // null: the forward-link lookup failed (backlinks are still returned)
  // []: the lookup succeeded and there are no problematic links
  linkTargets: ILinkTarget[] | null;
  // null: the job read failed (backlinks are still returned); the panel then flags nothing
  indexState: IBacklinksIndexState | null;
}

/**
 * What every reader of the panel may know about the backfill: whether backlinks from older
 * pages can be missing. Run details (errors, counts, the claim) stay on the admin endpoint.
 */
export interface IBacklinksIndexState {
  coverage: 'none' | 'partial' | 'all';
  // ISO 8601; set exactly when coverage is 'partial'
  coveredSince: string | null;
}

export interface ILinkTarget {
  // null when link is broken (toPage = null)
  // Non-null for 'trashed' or 'normal'
  pageId: string | null;
  // The target page's current path when it exists, the row's own 'toPath' when broken
  path: string;
  targetState: LinkTargetState;
}

/**
 * The health of one outbound link, derived at read time and never stored — which is what
 * makes a restore free: it flips inbound links back to `normal` with no write.
 */
export type LinkTargetState = 'normal' | 'trashed' | 'broken';
