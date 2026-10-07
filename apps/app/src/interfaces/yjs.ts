export type CurrentPageYjsData = {
  hasYdocsNewerThanLatestRevision?: boolean;
  awarenessStateSize?: number;
};

export type SyncLatestRevisionBody = {
  synced: boolean;
  isYjsDataBroken?: boolean;
};
