import type { IPageOperationProcessData } from '~/interfaces/page-operation.js';

export const shouldRecoverPagePaths = (
  processData: IPageOperationProcessData,
): boolean => {
  return processData.Rename?.Sub != null
    ? processData.Rename.Sub.isProcessable
    : false;
};
