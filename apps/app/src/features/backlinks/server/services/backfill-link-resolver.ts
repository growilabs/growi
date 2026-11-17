import { isPermalink } from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

export type BackfillLinkResolver = (toPath: string) => Types.ObjectId | null;

interface PageIdentity {
  readonly _id: Types.ObjectId;
  readonly path: string;
  readonly isEmpty?: boolean | null;
}

/**
 * Resolves extracted link paths from an in-memory snapshot, as the live `resolveToPageIds` does
 * minus redirect-following: a path resolves to the non-empty page at it, a permalink to the page
 * with that id, empty or not (the live permalink lookup does not filter empties either).
 */
export const createBackfillLinkResolver = (
  pages: Iterable<PageIdentity>,
): BackfillLinkResolver => {
  const idByPath = new Map<string, Types.ObjectId>();
  const idByHex = new Map<string, Types.ObjectId>();
  for (const page of pages) {
    idByHex.set(page._id.toString(), page._id);
    if (page.isEmpty !== true) idByPath.set(page.path, page._id);
  }

  return (toPath) =>
    isPermalink(toPath)
      ? (idByHex.get(removeHeadingSlash(toPath)) ?? null)
      : (idByPath.get(toPath) ?? null);
};

/** One projection query over every page; trashed pages stay in, so links to them read `trashed`. */
export const loadBackfillLinkResolver =
  async (): Promise<BackfillLinkResolver> => {
    const Page = mongoose.model<PageDocument, PageModel>('Page');
    const pages = await Page.find({})
      .select({ _id: 1, path: 1, isEmpty: 1 })
      .lean<PageIdentity[]>();
    return createBackfillLinkResolver(pages);
  };
