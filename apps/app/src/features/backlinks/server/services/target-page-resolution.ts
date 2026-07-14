import { isPermalink } from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

/**
 * Resolves page IDs for a batch of paths using at most two database calls.
 *
 * Inputs are split into permalinks (eg. '/6a4c8be9b698d2b7ab35cd6e') and
 * regular paths (eg. '/docs/new'), each resolved with a single `$in` query.
 * The two queries run concurrently.
 *
 * @param paths - Extracted absolute paths and/or permalinks.
 * @returns - Map from the original input string to its resolved page ID.
 *            Inputs with no matching page are absent from the map.
 */
export const resolveToPages = async (
  paths: string[],
): Promise<Map<string, Types.ObjectId>> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  const permalinkIds: string[] = [];
  const normalPaths: string[] = [];

  for (const path of paths) {
    if (isPermalink(path)) {
      permalinkIds.push(removeHeadingSlash(path));
    } else {
      normalPaths.push(path);
    }
  }

  const [byId, byPath] = await Promise.all([
    permalinkIds.length
      ? Page.find({ _id: { $in: permalinkIds } }).select('_id')
      : [],
    normalPaths.length
      ? // Match findByPath: exclude empty pages ({ isEmpty: null } for v4 compat).
        Page.find({
          path: { $in: normalPaths },
          $or: [{ isEmpty: false }, { isEmpty: null }],
        }).select('_id path')
      : [],
  ]);

  const result = new Map<string, Types.ObjectId>();

  for (const p of byId) result.set(`/${p._id.toString()}`, p._id);
  for (const p of byPath) result.set(p.path, p._id);

  return result;
};
