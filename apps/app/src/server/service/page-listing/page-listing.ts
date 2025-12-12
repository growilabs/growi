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
}

let pageOperationService: IPageOperationService;
async function getPageOperationServiceInstance(): Promise<IPageOperationService> {
  if (pageOperationService == null) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    pageOperationService = await import('../page-operation').then(
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
