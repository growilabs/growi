import type { IUser } from '@growi/core/dist/interfaces';
import { pagePathUtils } from '@growi/core/dist/utils';
import mongoose, { type HydratedDocument } from 'mongoose';

import type { IPageForTreeItem } from '~/interfaces/page';
import {
  type IPageOperationProcessData,
  type IPageOperationProcessInfo,
  PageActionType,
} from '~/interfaces/page-operation';
import {
  type PageDocument,
  type PageModel,
  PageQueryBuilder,
} from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';

import type { IPageOperationService } from '../page-operation';

const { hasSlash, generateChildrenRegExp } = pagePathUtils;

export interface IPageListingService {
  findRootByViewer(user: IUser): Promise<IPageForTreeItem>;
  findChildrenByParentPathOrIdAndViewer(
    parentPathOrId: string,
    user?: IUser,
    showPagesRestrictedByOwner?: boolean,
    showPagesRestrictedByGroup?: boolean,
  ): Promise<IPageForTreeItem[]>;
  findLimitedChildrenByParentIdAndViewer(
    parentId: string,
    user: IUser | undefined,
    limit: number,
  ): Promise<IPageForTreeItem[]>;
  countChildrenByParentIdAndViewer(
    parentId: string,
    user?: IUser,
  ): Promise<number>;
}

let pageOperationService: IPageOperationService;
async function getPageOperationServiceInstance(): Promise<IPageOperationService> {
  if (pageOperationService == null) {
    pageOperationService = await import('../page-operation').then(
      // biome-ignore lint/style/noNonNullAssertion: the module must export pageOperationService
      (mod) => mod.pageOperationService!,
    );
  }
  return pageOperationService;
}

class PageListingService implements IPageListingService {
  async findRootByViewer(user?: IUser): Promise<IPageForTreeItem> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    const builder = new PageQueryBuilder(Page.findOne({ path: '/' }));
    await builder.addViewerCondition(user);

    return builder.query
      .select('_id path parent revision descendantCount grant isEmpty wip')
      .lean()
      .exec();
  }

  async findChildrenByParentPathOrIdAndViewer(
    parentPathOrId: string,
    user?: IUser,
    showPagesRestrictedByOwner = false,
    showPagesRestrictedByGroup = false,
  ): Promise<IPageForTreeItem[]> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );
    let queryBuilder: PageQueryBuilder;
    if (hasSlash(parentPathOrId)) {
      const path = parentPathOrId;
      const regexp = generateChildrenRegExp(path);
      queryBuilder = new PageQueryBuilder(
        Page.find({ path: { $regex: regexp } }),
        true,
      );
    } else {
      const parentId = parentPathOrId;
      // Use $eq for user-controlled sources. see: https://codeql.github.com/codeql-query-help/javascript/js-sql-injection/#recommendation
      queryBuilder = new PageQueryBuilder(
        Page.find({ parent: { $eq: parentId } }),
        true,
      );
    }
    await queryBuilder.addViewerCondition(
      user,
      null,
      undefined,
      showPagesRestrictedByOwner,
      showPagesRestrictedByGroup,
    );

    const pages: HydratedDocument<Omit<IPageForTreeItem, 'processData'>>[] =
      await queryBuilder
        .addConditionToSortPagesByAscPath()
        .query.select(
          '_id path parent revision descendantCount grant isEmpty wip',
        )
        .lean()
        .exec();

    const injectedPages = await this.injectProcessDataIntoPagesByActionTypes(
      pages,
      [PageActionType.Rename],
    );

    // Type-safe conversion to IPageForTreeItem
    return injectedPages.map((page) =>
      Object.assign(page, { _id: page._id.toString() }),
    );
  }

  /**
   * Return at most `limit` viewer-visible direct children of the given parent page id,
   * limited at the query level (never by slicing an all-loaded array) so memory stays
   * bounded even when a page has many children. Mirrors the semantics of
   * findChildrenByParentPathOrIdAndViewer (viewer grant filter, empty container pages
   * included, ascending path order) but resolves strictly by parent id — no path regex.
   * Intended for the page-markdown footer, where only the first N children are linked.
   */
  async findLimitedChildrenByParentIdAndViewer(
    parentId: string,
    user: IUser | undefined,
    limit: number,
  ): Promise<IPageForTreeItem[]> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    // Use $eq for user-controlled sources. see: https://codeql.github.com/codeql-query-help/javascript/js-sql-injection/#recommendation
    const queryBuilder = new PageQueryBuilder(
      Page.find({ parent: { $eq: parentId } }),
      true,
    );
    // Share the exact viewer condition with countChildrenByParentIdAndViewer so the
    // grant logic is not re-implemented and the two can never drift apart.
    await queryBuilder.addViewerCondition(user);

    const pages: HydratedDocument<Omit<IPageForTreeItem, 'processData'>>[] =
      await queryBuilder
        .addConditionToPagenate(0, limit, 'path')
        .query.select(
          '_id path parent revision descendantCount grant isEmpty wip',
        )
        .lean()
        .exec();

    const injectedPages = await this.injectProcessDataIntoPagesByActionTypes(
      pages,
      [PageActionType.Rename],
    );

    // Type-safe conversion to IPageForTreeItem
    return injectedPages.map((page) =>
      Object.assign(page, { _id: page._id.toString() }),
    );
  }

  /**
   * Return the exact number of viewer-visible direct children of the given parent page id.
   * Uses countDocuments({ parent: id }) with the same addViewerCondition applied to the
   * limited fetch above, so the total reflects the identical grant filter (no double
   * implementation) and is not affected by the footer link limit.
   */
  async countChildrenByParentIdAndViewer(
    parentId: string,
    user?: IUser,
  ): Promise<number> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    // Use $eq for user-controlled sources. see: https://codeql.github.com/codeql-query-help/javascript/js-sql-injection/#recommendation
    const queryBuilder = new PageQueryBuilder(
      Page.countDocuments({ parent: { $eq: parentId } }),
      true,
    );
    await queryBuilder.addViewerCondition(user);

    return queryBuilder.query.exec();
  }

  /**
   * Inject processData into page docuements
   * The processData is a combination of actionType as a key and information on whether the action is processable as a value.
   */
  private async injectProcessDataIntoPagesByActionTypes<T>(
    pages: HydratedDocument<T>[],
    actionTypes: PageActionType[],
  ): Promise<
    (HydratedDocument<T> & { processData?: IPageOperationProcessData })[]
  > {
    const pageOperations = await PageOperation.find({
      actionType: { $in: actionTypes },
    });
    if (pageOperations == null || pageOperations.length === 0) {
      return pages.map((page) =>
        Object.assign(page, { processData: undefined }),
      );
    }

    const pageOperationService = await getPageOperationServiceInstance();
    const processInfo: IPageOperationProcessInfo =
      pageOperationService.generateProcessInfo(pageOperations);
    const operatingPageIds: string[] = Object.keys(processInfo);

    // inject processData into pages
    return pages.map((page) => {
      const pageId = page._id.toString();
      if (operatingPageIds.includes(pageId)) {
        const processData: IPageOperationProcessData = processInfo[pageId];
        return Object.assign(page, { processData });
      }
      return Object.assign(page, { processData: undefined });
    });
  }
}

export const pageListingService = new PageListingService();
