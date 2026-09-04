export interface IBacklink {
  pageId: string;
  path: string;
}

export interface IBacklinkResponse {
  backlinks: IBacklink[];
}

/**
 * The health of one outbound link, derived at read time and never stored — which is what
 * makes a restore free: it flips inbound links back to `normal` with no write.
 */
export type LinkTargetState = 'normal' | 'trashed' | 'broken';
