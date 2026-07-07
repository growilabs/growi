import type { IPage } from '@growi/core';
import { isPermalink } from '@growi/core/dist/utils/page-path-utils';
import type { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

/**
 * Resolves and returns ID for a page from its path.
 *
 * @param path - Extracted absolute path or permalink eg. '/docs/new' or '/6a4c8be9b698d2b7ab35cd6e'.
 * @returns - Resolved ID for page.
 */
export const resolveToPage = async (path: string): Promise<ObjectId | null> => {
  const Page = mongoose.model<IPage>('Page');

  if (isPermalink(path)) {
    const id = path.slice(1);
    const page = await Page.findById(id);

    if (page == null) {
      return null;
    }

    return page._id;
  }

  const page = await Page.findOne({ path });

  if (page == null) {
    return null;
  }

  return page._id;
};
