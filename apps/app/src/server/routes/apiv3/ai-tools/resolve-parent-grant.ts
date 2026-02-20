import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

export const resolveParentGrant = async (dirPath: string): Promise<number> => {
  const pagePath = dirPath.replace(/\/$/, '') || '/';

  const Page = mongoose.model('Page');
  const page = await Page.findOne({ path: pagePath }).lean();

  if (page == null) {
    return PageGrant.GRANT_OWNER;
  }

  return (page as { grant: number }).grant;
};
