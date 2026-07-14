import { isPermalink } from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

/**
 * Resolves and returns ID for a page from its path.
 *
 * @param path - Extracted absolute path or permalink eg. '/docs/new' or '/6a4c8be9b698d2b7ab35cd6e'.
 * @returns - Resolved ID for page.
 */
export const resolveToPage = async (
  path: string,
): Promise<Types.ObjectId | null> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  if (isPermalink(path)) {
    const id = removeHeadingSlash(path);
    const page = await Page.findById(id);

    return page?._id ?? null;
  }

  const page = await Page.findByPath(path);

  return page?._id ?? null;
};
