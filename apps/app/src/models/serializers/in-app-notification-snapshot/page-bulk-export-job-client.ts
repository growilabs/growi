export interface IPageBulkExportJobSnapshot {
  path: string;
}

export const parseSnapshot = (snapshot: string): IPageBulkExportJobSnapshot => {
  return JSON.parse(snapshot);
};
