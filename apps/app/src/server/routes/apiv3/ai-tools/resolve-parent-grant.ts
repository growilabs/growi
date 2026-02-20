import { PageGrant } from '@growi/core';
import mongoose, { type Model } from 'mongoose';

type PageWithGrant = { grant: number };

const findGrantInAncestors = async (
  Page: Model<PageWithGrant>,
  path: string,
): Promise<number | null> => {
  const page = await Page.findOne({ path }).lean();

  if (page != null) {
    return page.grant;
  }

  if (path === '/') {
    return null;
  }

  const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';
  return findGrantInAncestors(Page, parentPath);
};

export const resolveParentGrant = async (dirPath: string): Promise<number> => {
  const Page = mongoose.model('Page');
  const pagePath = dirPath.replace(/\/$/, '') || '/';

  const grant = await findGrantInAncestors(Page, pagePath);
  return grant ?? PageGrant.GRANT_OWNER;
};
