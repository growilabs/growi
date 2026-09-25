export interface IBacklink {
  pageId: string;
  path: string;
}

export interface IBacklinkResponse {
  backlinks: IBacklink[];
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
