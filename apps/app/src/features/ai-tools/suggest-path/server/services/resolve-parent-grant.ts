import { PageGrant } from '@growi/core';
import { pathUtils } from '@growi/core/dist/utils';
import mongoose from 'mongoose';

type PageWithGrant = { path: string; grant: number };

const MAX_ANCESTOR_DEPTH = 50;

export function getAncestorPaths(pagePath: string): string[] {
  const paths: string[] = [];
  let current = pagePath;
  let depth = 0;

  while (current !== '/' && depth < MAX_ANCESTOR_DEPTH) {
    paths.push(current);
    current = pathUtils.getParentPath(current);
    depth++;
  }

  paths.push('/');
  return paths;
}

export const resolveParentGrant = async (dirPath: string): Promise<number> => {
  const Page = mongoose.model<PageWithGrant>('Page');
  const pagePath = pathUtils.removeTrailingSlash(dirPath);

  const ancestorPaths = getAncestorPaths(pagePath);

  const pages = await Page.find({ path: { $in: ancestorPaths } })
    .select('path grant')
    .lean();

  // Find the closest ancestor (ancestorPaths is ordered from child to root)
  for (const ancestorPath of ancestorPaths) {
    const page = pages.find((p) => p.path === ancestorPath);
    if (page != null) {
      return page.grant;
    }
  }

  return PageGrant.GRANT_OWNER;
};
