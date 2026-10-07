import { isTopPage } from '@growi/core/dist/utils/page-path-utils';

export const getDepthOfPath = (path: string): number => {
  if (isTopPage(path)) {
    return 0;
  }
  return (path.match(/\//g) ?? []).length;
};
