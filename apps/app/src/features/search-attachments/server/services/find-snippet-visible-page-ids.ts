import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';
import type SearchService from '~/server/service/search';

import type {
  AttachmentSearchViewer,
  FindSnippetVisiblePageIdsFn,
} from './search-accessible-pages';

/**
 * Loads the pages from MongoDB the way page search's result formatting does
 * (empty pages excluded) and keeps the ids whose grant lets the viewer see
 * content, judged by the same `canShowSnippet` page search uses.
 */
export const createFindSnippetVisiblePageIds =
  (
    searchService: Pick<SearchService, 'canShowSnippet'>,
  ): FindSnippetVisiblePageIdsFn =>
  async (pageIds: readonly string[], viewer: AttachmentSearchViewer) => {
    if (pageIds.length === 0) {
      return new Set();
    }
    const Page = mongoose.model<IPage, PageModel>('Page');
    const builder = new Page.PageQueryBuilder(
      Page.find({ _id: { $in: pageIds } }),
      false,
    );
    const pages = await builder.query
      .select('_id grant grantedUsers grantedGroups')
      .lean()
      .exec();

    return new Set(
      pages
        .filter((page) =>
          searchService.canShowSnippet(page, viewer.user, viewer.userGroups),
        )
        .map((page) => page._id.toString()),
    );
  };
