export interface IBacklink {
  pageId: string;
  path: string;
}

export interface IBacklinkResponse {
  backlinks: IBacklink[];
}
