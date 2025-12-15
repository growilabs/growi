import {
  getIdForRef,
  getIdStringForRef,
  PageStatus,
  YDocStatus,
} from '@growi/core';
import type {
  HasObjectId,
  IDataWithRequiredMeta,
  IGrantedGroup,
  IPage,
  IPageInfo,
  IPageInfoExt,
  IPageInfoForEmpty,
  IPageInfoForEntity,
  IPageInfoForOperation,
  IPageNotFoundInfo,
  IRevisionHasId,
  IUser,
  IUserHasId,
  Ref,
} from '@growi/core/dist/interfaces';
import { isIPageInfoForEntity, PageGrant } from '@growi/core/dist/interfaces';
import { pagePathUtils, pathUtils } from '@growi/core/dist/utils';
import assert from 'assert';
import escapeStringRegexp from 'escape-string-regexp';
import type EventEmitter from 'events';
import type { Cursor, HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import pathlib from 'path';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';

import { Comment } from '~/features/comment/server';
import type { ExternalUserGroupDocument } from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import { isAiEnabled } from '~/features/openai/server/services';
import { SupportedAction } from '~/interfaces/activity';
import type { BookmarkedPage } from '~/interfaces/bookmark-info';
import { V5ConversionErrCode } from '~/interfaces/errors/v5-conversion-error';
import type { IOptionsForCreate, IOptionsForUpdate } from '~/interfaces/page';
import type { IPageDeleteConfigValueToProcessValidation } from '~/interfaces/page-delete-config';
import {
  PageDeleteConfigValue,
  PageSingleDeleteCompConfigValue,
} from '~/interfaces/page-delete-config';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import { PageActionOnGroupDelete } from '~/interfaces/user-group';
import {
  type PageMigrationErrorData,
  SocketEventName,
  type UpdateDescCountRawData,
} from '~/interfaces/websocket';
import type { CurrentPageYjsData } from '~/interfaces/yjs';
import type Crowi from '~/server/crowi';
import type { CreateMethod } from '~/server/models/page';
import {
  type PageDocument,
  type PageModel,
  PageQueryBuilder,
  pushRevision,
} from '~/server/models/page';
import type { PageTagRelationDocument } from '~/server/models/page-tag-relation';
import PageTagRelation from '~/server/models/page-tag-relation';
import type { UserGroupDocument } from '~/server/models/user-group';
import { createBatchStream } from '~/server/util/batch-stream';
import { collectAncestorPaths } from '~/server/util/collect-ancestor-paths';
import { generalXssFilter } from '~/services/general-xss-filter';
import loggerFactory from '~/utils/logger';
import { prepareDeleteConfigValuesForCalc } from '~/utils/page-delete-config';

import type { ObjectIdLike } from '../../interfaces/mongoose-utils';
import { Attachment } from '../../models/attachment';
import { PathAlreadyExistsError } from '../../models/errors';
import type { PageOperationDocument } from '../../models/page-operation';
import PageOperation from '../../models/page-operation';
import PageRedirect from '../../models/page-redirect';
import type { IRevisionDocument } from '../../models/revision';
import { Revision } from '../../models/revision';
import { serializePageSecurely } from '../../models/serializers/page-serializer';
import ShareLink from '../../models/share-link';
import Subscription from '../../models/subscription';
import UserGroupRelation from '../../models/user-group-relation';
import { V5ConversionError } from '../../models/vo/v5-conversion-error';
import { divideByType } from '../../util/granted-group';
import { configManager } from '../config-manager';
import type { IPageGrantService } from '../page-grant';
import { preNotifyService } from '../pre-notify';
import { getYjsService } from '../yjs';
import { BULK_REINDEX_SIZE, LIMIT_FOR_MULTIPLE_PAGE_OP } from './consts';
import type { IPageService } from './page-service';
import { shouldUseV4Process } from './should-use-v4-process';

export * from './page-service';

const logger = loggerFactory('growi:services:page');
const {
  isTrashPage,
  isTopPage,
  omitDuplicateAreaPageFromPages,
  getUsernameByPath,
  isUsersTopPage,
  isMovablePage,
  isUsersHomepage,
  hasSlash,
  generateChildrenRegExp,
} = pagePathUtils;

const { addTrailingSlash } = pathUtils;

// TODO: improve type
class PageCursorsForDescendantsFactory {
  private user: any; // TODO: Typescriptize model

  private rootPage: any; // TODO: wait for mongoose update

  private shouldIncludeEmpty: boolean;

  private initialCursor: Cursor<any> | never[]; // TODO: wait for mongoose update

  constructor(user: any, rootPage: any, shouldIncludeEmpty: boolean) {
    this.user = user;
    this.rootPage = rootPage;
    this.shouldIncludeEmpty = shouldIncludeEmpty;
  }

  // prepare initial cursor
  private async init() {
    const initialCursor = await this.generateCursorToFindChildren(
      this.rootPage,
    );
    this.initialCursor = initialCursor;
  }

  /**
   * Returns Iterable that yields only descendant pages unorderedly
   * @returns Promise<AsyncGenerator>
   */
  async generateIterable(): Promise<AsyncGenerator | never[]> {
    // initialize cursor
    await this.init();

    return this.isNeverArray(this.initialCursor)
      ? []
      : this.generateOnlyDescendants(this.initialCursor);
  }

  /**
   * Returns Readable that produces only descendant pages unorderedly
   * @returns Promise<Readable>
   */
  async generateReadable(): Promise<Readable> {
    return Readable.from(await this.generateIterable());
  }

  /**
   * Generator that unorderedly yields descendant pages
   */
  private async *generateOnlyDescendants(cursor: Cursor<any>) {
    for await (const page of cursor) {
      const nextCursor = await this.generateCursorToFindChildren(page);
      if (!this.isNeverArray(nextCursor)) {
        yield* this.generateOnlyDescendants(nextCursor); // recursively yield
      }

      yield page;
    }
  }

  private async generateCursorToFindChildren(
    page: any,
  ): Promise<Cursor<any> | never[]> {
    if (page == null) {
      return [];
    }

    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );
    const { PageQueryBuilder } = Page;

    const builder = new PageQueryBuilder(Page.find(), this.shouldIncludeEmpty);
    builder.addConditionToFilteringByParentId(page._id);

    const cursor = builder.query
      .lean()
      .cursor({ batchSize: BULK_REINDEX_SIZE }) as Cursor<any>;

    return cursor;
  }

  private isNeverArray(val: Cursor<any> | never[]): val is never[] {
    return 'length' in val && val.length === 0;
  }
}

class PageService implements IPageService {
  crowi: Crowi;

  pageEvent: EventEmitter & {
    onCreate;
    onCreateMany;
    onAddSeenUsers;
  };

  tagEvent: any;

  activityEvent: any;

  pageGrantService: IPageGrantService;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.pageEvent = crowi.event('page');
    this.tagEvent = crowi.event('tag');
    this.activityEvent = crowi.event('activity');
    this.pageGrantService = crowi.pageGrantService;

    // init
    this.initPageEvent();
    this.canDeleteCompletely = this.canDeleteCompletely.bind(this);
    this.canDelete = this.canDelete.bind(this);
  }

  private initPageEvent() {
    // create
    this.pageEvent.on('create', this.pageEvent.onCreate);

    // createMany
    this.pageEvent.on('createMany', this.pageEvent.onCreateMany);
    this.pageEvent.on('addSeenUsers', this.pageEvent.onAddSeenUsers);
  }

  getEventEmitter(): EventEmitter {
    return this.pageEvent;
  }

  /**
   * Check if page can be deleted completely.
   * Use the following methods before execution of canDeleteCompletely to get params.
   *   - pageService.getCreatorIdForCanDelete: creatorId
   *   - pageGrantService.getUserRelatedGroups: userRelatedGroups
   * Do NOT make this method async as for now, because canDeleteCompletely is called in /page-listing/info in a for loop,
   * and /page-listing/info should not be an execution heavy API.
   */
  canDeleteCompletely(
    page: PageDocument,
    creatorId: ObjectIdLike | null,
    operator: any | null,
    isRecursively: boolean,
    userRelatedGroups: PopulatedGrantedGroup[],
  ): boolean {
    if (operator == null || isTopPage(page.path) || isUsersTopPage(page.path))
      return false;

    const pageCompleteDeletionAuthority = configManager.getConfig(
      'security:pageCompleteDeletionAuthority',
    );
    const pageRecursiveCompleteDeletionAuthority = configManager.getConfig(
      'security:pageRecursiveCompleteDeletionAuthority',
    );

    if (
      !this.canDeleteCompletelyAsMultiGroupGrantedPage(
        page,
        creatorId,
        operator,
        userRelatedGroups,
      )
    )
      return false;

    const [singleAuthority, recursiveAuthority] =
      prepareDeleteConfigValuesForCalc(
        pageCompleteDeletionAuthority,
        pageRecursiveCompleteDeletionAuthority,
      );

    return this.canDeleteLogic(
      creatorId,
      operator,
      isRecursively,
      singleAuthority,
      recursiveAuthority,
    );
  }

  /**
   * If page is multi-group granted, check if operator is allowed to completely delete the page.
   * see: https://dev.growi.org/656745fa52eafe1cf1879508#%E5%AE%8C%E5%85%A8%E3%81%AB%E5%89%8A%E9%99%A4%E3%81%99%E3%82%8B%E6%93%8D%E4%BD%9C
   * creatorId must be obtained by getCreatorIdForCanDelete
   */
  canDeleteCompletelyAsMultiGroupGrantedPage(
    page: PageDocument,
    creatorId: ObjectIdLike | null,
    operator: any | null,
    userRelatedGroups: PopulatedGrantedGroup[],
  ): boolean {
    const pageCompleteDeletionAuthority = configManager.getConfig(
      'security:pageCompleteDeletionAuthority',
    );
    const isAllGroupMembershipRequiredForPageCompleteDeletion =
      configManager.getConfig(
        'security:isAllGroupMembershipRequiredForPageCompleteDeletion',
      );

    const isAdmin = operator?.admin ?? false;
    const isAuthor =
      operator?._id == null ? false : operator._id.equals(creatorId);
    const isAdminOrAuthor = isAdmin || isAuthor;

    if (
      page.grant === PageGrant.GRANT_USER_GROUP &&
      !isAdminOrAuthor &&
      pageCompleteDeletionAuthority ===
        PageSingleDeleteCompConfigValue.Anyone &&
      isAllGroupMembershipRequiredForPageCompleteDeletion
    ) {
      const userRelatedGrantedGroups =
        this.pageGrantService.getUserRelatedGrantedGroupsSyncronously(
          userRelatedGroups,
          page,
        );
      if (userRelatedGrantedGroups.length !== page.grantedGroups.length) {
        return false;
      }
    }

    return true;
  }

  // When page is empty, the 'canDelete' judgement should be done using the creator of the closest non-empty ancestor page.
  async getCreatorIdForCanDelete(
    page: PageDocument,
  ): Promise<ObjectIdLike | null> {
    if (page.isEmpty) {
      const Page = mongoose.model<IPage, PageModel>('Page');
      const notEmptyClosestAncestor = await Page.findNonEmptyClosestAncestor(
        page.path,
      );
      return notEmptyClosestAncestor?.creator == null
        ? null
        : getIdForRef(notEmptyClosestAncestor.creator);
    }

    return page.creator == null ? null : getIdForRef(page.creator);
  }

  // Use getCreatorIdForCanDelete before execution of canDelete to get creatorId.
  canDelete(
    page: PageDocument,
    creatorId: ObjectIdLike | null,
    operator: any | null,
    isRecursively: boolean,
  ): boolean {
    if (operator == null || isTopPage(page.path) || isUsersTopPage(page.path))
      return false;

    const pageDeletionAuthority = configManager.getConfig(
      'security:pageDeletionAuthority',
    );
    const pageRecursiveDeletionAuthority = configManager.getConfig(
      'security:pageRecursiveDeletionAuthority',
    );

    const [singleAuthority, recursiveAuthority] =
      prepareDeleteConfigValuesForCalc(
        pageDeletionAuthority,
        pageRecursiveDeletionAuthority,
      );

    return this.canDeleteLogic(
      creatorId,
      operator,
      isRecursively,
      singleAuthority,
      recursiveAuthority,
    );
  }

  canDeleteUserHomepageByConfig(): boolean {
    return (
      configManager.getConfig('security:user-homepage-deletion:isEnabled') ??
      false
    );
  }

  async isUsersHomepageOwnerAbsent(path: string): Promise<boolean> {
    const User = mongoose.model('User');
    const username = getUsernameByPath(path);
    if (username == null) {
      throw new Error('Cannot found username by path');
    }
    const ownerExists = await User.exists({ username }).exec();
    return ownerExists == null;
  }

  private canDeleteLogic(
    creatorId: ObjectIdLike | null,
    operator,
    isRecursively: boolean,
    authority: IPageDeleteConfigValueToProcessValidation | null,
    recursiveAuthority: IPageDeleteConfigValueToProcessValidation | null,
  ): boolean {
    const isAdmin = operator?.admin ?? false;
    const isAuthor =
      operator?._id == null ? false : operator._id.equals(creatorId);

    if (isRecursively) {
      return this.compareDeleteConfig(isAdmin, isAuthor, recursiveAuthority);
    }

    return this.compareDeleteConfig(isAdmin, isAuthor, authority);
  }

  private compareDeleteConfig(
    isAdmin: boolean,
    isAuthor: boolean,
    authority: IPageDeleteConfigValueToProcessValidation | null,
  ): boolean {
    if (isAdmin) {
      return true;
    }

    if (authority === PageDeleteConfigValue.Anyone || authority == null) {
      return true;
    }
    if (authority === PageDeleteConfigValue.AdminAndAuthor && isAuthor) {
      return true;
    }

    return false;
  }

  private async getAbsenseUserHomeList(
    pages: PageDocument[],
  ): Promise<string[]> {
    const userHomepages = pages.filter((p) => isUsersHomepage(p.path));

    const User = mongoose.model<IUser>('User');
    const usernames = userHomepages
      .map((page) => getUsernameByPath(page.path))
      // see: https://zenn.dev/kimuson/articles/filter_safety_type_guard
      .filter(
        (username): username is Exclude<typeof username, null> =>
          username !== null,
      );
    const existingUsernames = await User.distinct<string>('username', {
      username: { $in: usernames },
    });

    return userHomepages
      .filter((page) => {
        const username = getUsernameByPath(page.path);
        if (username == null) {
          throw new Error('Cannot found username by path');
        }
        return !existingUsernames.includes(username);
      })
      .map((p) => p.path);
  }

  private async filterPages(
    pages: PageDocument[],
    user: IUserHasId,
    isRecursively: boolean,
    canDeleteFunction: (
      page: PageDocument,
      creatorId: ObjectIdLike | null,
      operator: any,
      isRecursively: boolean,
      userRelatedGroups: PopulatedGrantedGroup[],
    ) => boolean,
  ): Promise<PageDocument[]> {
    const userRelatedGroups =
      await this.pageGrantService.getUserRelatedGroups(user);
    const filteredPages = pages.filter(async (p) => {
      if (p.isEmpty) return true;
      const canDelete = canDeleteFunction(
        p,
        p.creator == null ? null : getIdForRef(p.creator),
        user,
        isRecursively,
        userRelatedGroups,
      );
      return canDelete;
    });

    if (!this.canDeleteUserHomepageByConfig()) {
      return filteredPages.filter((p) => !isUsersHomepage(p.path));
    }

    // Confirmation of deletion of user homepages is an asynchronous process,
    // so it is processed separately for performance optimization.
    const absenseUserHomeList =
      await this.getAbsenseUserHomeList(filteredPages);

    const excludeActiveUserHomepage = (path: string) => {
      if (!isUsersHomepage(path)) {
        return true;
      }
      return absenseUserHomeList.includes(path);
    };

    return filteredPages.filter((p) => excludeActiveUserHomepage(p.path));
  }

  async filterPagesByCanDeleteCompletely(
    pages: PageDocument[],
    user: IUserHasId,
    isRecursively: boolean,
  ): Promise<PageDocument[]> {
    return this.filterPages(
      pages,
      user,
      isRecursively,
      this.canDeleteCompletely,
    );
  }

  async filterPagesByCanDelete(
    pages: PageDocument[],
    user: IUserHasId,
    isRecursively: boolean,
  ): Promise<PageDocument[]> {
    return this.filterPages(pages, user, isRecursively, this.canDelete);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async findPageAndMetaDataByViewer(
    pageId: string | null, // either pageId or path must be specified
    path: string | null, // either pageId or path must be specified
    user?: HydratedDocument<IUser>,
    isSharedPage = false,
  ): Promise<
    | IDataWithRequiredMeta<HydratedDocument<PageDocument>, IPageInfoExt>
    | IDataWithRequiredMeta<null, IPageNotFoundInfo>
  > {
    assert(pageId != null || path != null);

    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    let page: HydratedDocument<PageDocument> | null;
    if (pageId != null) {
      // prioritized
      page = await Page.findByIdAndViewer(pageId, user, null, true);
    } else {
      page = await Page.findByPathAndViewer(path, user, null, true, true);
    }

    // not found or forbidden
    if (page == null) {
      const count =
        pageId != null
          ? await Page.count({ _id: pageId })
          : await Page.count({ path });
      const isForbidden = count > 0;
      return {
        data: null,
        meta: {
          isNotFound: true,
          isForbidden,
        } satisfies IPageNotFoundInfo,
      };
    }

    const isGuestUser = user == null;
    const basicPageInfo = this.constructBasicPageInfo(page, isGuestUser);

    if (isSharedPage) {
      return {
        data: page,
        meta: {
          ...basicPageInfo,
          isMovable: false,
          isDeletable: false,
          isAbleToDeleteCompletely: false,
          isRevertible: false,
          bookmarkCount: 0,
        } satisfies IPageInfo,
      };
    }

    const Bookmark = mongoose.model<
      BookmarkedPage,
      { countDocuments; findByPageIdAndUserId }
    >('Bookmark');
    const bookmarkCount: number = await Bookmark.countDocuments({
      page: pageId,
    });

    const pageInfo = {
      ...basicPageInfo,
      bookmarkCount,
    };

    if (isGuestUser) {
      return {
        data: page,
        meta: {
          ...pageInfo,
          isDeletable: false,
          isAbleToDeleteCompletely: false,
        } satisfies IPageInfo,
      };
    }

    const creatorId = await this.getCreatorIdForCanDelete(page);

    const userRelatedGroups =
      await this.pageGrantService.getUserRelatedGroups(user);

    const isDeletable = this.canDelete(page, creatorId, user, false);
    const isAbleToDeleteCompletely = this.canDeleteCompletely(
      page,
      creatorId,
      user,
      false,
      userRelatedGroups,
    ); // use normal delete config
    const isBookmarked: boolean = isGuestUser
      ? false
      : (await Bookmark.findByPageIdAndUserId(pageId, user._id)) != null;

    if (pageInfo.isEmpty) {
      return {
        data: page,
        meta: {
          ...pageInfo,
          isDeletable,
          isAbleToDeleteCompletely,
          isBookmarked,
        } satisfies IPageInfoForEmpty,
      };
    }

    // IPageInfoForEmpty and IPageInfoForEntity are mutually exclusive
    // so hereafter we can safely
    assert(isIPageInfoForEntity(pageInfo));

    const isLiked: boolean = page.isLiked(user);
    const subscription = await Subscription.findByUserIdAndTargetId(
      user._id,
      page._id,
    );

    return {
      data: page,
      meta: {
        ...pageInfo,
        isDeletable,
        isAbleToDeleteCompletely,
        isBookmarked,
        isLiked,
        subscriptionStatus: subscription?.status,
      } satisfies IPageInfoForOperation,
    };
  }

  private shouldUseV4ProcessForRevert(page): boolean {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const isV5Compatible = configManager.getConfig('app:isV5Compatible');
    const isPageRestricted = page.grant === Page.GRANT_RESTRICTED;

    const shouldUseV4Process = !isV5Compatible || isPageRestricted;

    return shouldUseV4Process;
  }

  private shouldNormalizeParent(page): boolean {
    const Page = mongoose.model('Page') as unknown as PageModel;

    return (
      page.grant !== Page.GRANT_RESTRICTED &&
      page.grant !== Page.GRANT_SPECIFIED
    );
  }

  /**
   * Generate read stream to operate descendants of the specified page path
   * @param {string} targetPagePath
   * @param {User} viewer
   */
  private async generateReadStreamToOperateOnlyDescendants(
    targetPagePath,
    userToOperate,
  ) {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const { PageQueryBuilder } = Page;

    const builder = new PageQueryBuilder(Page.find(), true)
      .addConditionAsRootOrNotOnTree() // to avoid affecting v5 pages
      .addConditionToListOnlyDescendants(targetPagePath);

    await Page.addConditionToFilteringByViewerToEdit(builder, userToOperate);
    return builder.query.lean().cursor({ batchSize: BULK_REINDEX_SIZE });
  }

  async renamePage(
    page: IPage,
    newPagePath,
    user,
    options,
    activityParameters,
  ): Promise<PageDocument | null> {
    /*
     * Common Operation
     */
    const Page = mongoose.model('Page') as unknown as PageModel;

    const parameters = {
      ip: activityParameters.ip,
      endpoint: activityParameters.endpoint,
      action:
        page.descendantCount > 0
          ? SupportedAction.ACTION_PAGE_RECURSIVELY_RENAME
          : SupportedAction.ACTION_PAGE_RENAME,
      user,
      targetModel: 'Page',
      target: page,
      snapshot: {
        username: user.username,
      },
    };

    const activity =
      await this.crowi.activityService.createActivity(parameters);

    const isExist = await Page.exists({ path: newPagePath, isEmpty: false });
    if (isExist) {
      throw Error(`Page already exists at ${newPagePath}`);
    }

    if (isTopPage(page.path)) {
      throw Error('It is forbidden to rename the top page');
    }

    // Separate v4 & v5 process
    const isShouldUseV4Process = shouldUseV4Process(page);
    if (isShouldUseV4Process) {
      return this.renamePageV4(page, newPagePath, user, options);
    }

    const canOperate = await this.crowi.pageOperationService.canOperate(
      true,
      page.path,
      newPagePath,
    );
    if (!canOperate) {
      throw Error(`Cannot operate rename to path "${newPagePath}" right now.`);
    }

    /*
     * Resumable Operation
     */
    let pageOp: PageOperationDocument;
    try {
      pageOp = await PageOperation.create({
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Main,
        page,
        user,
        fromPath: page.path,
        toPath: newPagePath,
        options,
      });
    } catch (err) {
      logger.error('Failed to create PageOperation document.', err);
      throw err;
    }
    let renamedPage: PageDocument | null = null;
    try {
      renamedPage = await this.renameMainOperation(
        page,
        newPagePath,
        user,
        options,
        pageOp._id,
        activity,
      );
    } catch (err) {
      logger.error('Error occurred while running renameMainOperation', err);

      // cleanup
      await PageOperation.deleteOne({ _id: pageOp._id });

      throw err;
    }
    if (page.descendantCount < 1) {
      const preNotify = preNotifyService.generatePreNotify(activity);

      this.activityEvent.emit('updated', activity, page, preNotify);
    }

    this.disableAncestorPagesTtl(newPagePath);
    return renamedPage;
  }

  async renameMainOperation(
    page,
    newPagePath: string,
    user,
    options,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<PageDocument | null> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const updateMetadata = options.updateMetadata || false;
    // sanitize path
    newPagePath = generalXssFilter.process(newPagePath); // eslint-disable-line no-param-reassign

    // UserGroup & Owner validation
    // use the parent's grant when target page is an empty page
    let grant: PageGrant;
    let grantedUserIds: ObjectIdLike[] | undefined;
    let grantedGroupIds: IGrantedGroup[];
    if (page.isEmpty) {
      const parent = await Page.findOne({ _id: page.parent });
      if (parent == null) {
        throw Error('parent not found');
      }
      grant = parent.grant;
      grantedUserIds = parent.grantedUsers.map((u) => getIdForRef(u));
      grantedGroupIds = parent.grantedGroups;
    } else {
      grant = page.grant;
      grantedUserIds = page.grantedUsers;
      grantedGroupIds = page.grantedGroups;
    }

    if (grant !== Page.GRANT_RESTRICTED) {
      let isGrantNormalized = false;
      try {
        isGrantNormalized = await this.pageGrantService.isGrantNormalized(
          user,
          newPagePath,
          grant,
          grantedUserIds,
          grantedGroupIds,
          false,
        );
      } catch (err) {
        logger.error(
          `Failed to validate grant of page at "${newPagePath}" when renaming`,
          err,
        );
        throw err;
      }
      if (!isGrantNormalized) {
        throw Error(
          `This page cannot be renamed to "${newPagePath}" since the selected grant or grantedGroup is not assignable to this page.`,
        );
      }
    }

    // 1. Take target off from tree
    await Page.takeOffFromTree(page._id);

    // 2. Find new parent
    let newParent: PageDocument | undefined;
    // If renaming to under target, run getParentAndforceCreateEmptyTree to fill new ancestors
    if (this.isRenamingToUnderTarget(page.path, newPagePath)) {
      newParent = await this.getParentAndforceCreateEmptyTree(
        page,
        newPagePath,
      );
    } else {
      newParent = await this.getParentAndFillAncestorsByUser(user, newPagePath);
    }

    // 3. Put back target page to tree (also update the other attrs)
    const update: Partial<IPage> = {};
    update.path = newPagePath;
    update.parent = newParent?._id;
    if (updateMetadata) {
      update.lastUpdateUser = user;
      update.updatedAt = new Date();
    }
    const renamedPage = await Page.findByIdAndUpdate(
      page._id,
      { $set: update },
      { new: true },
    );

    // 5.increase parent's descendantCount.
    // see: https://dev.growi.org/62149d019311629d4ecd91cf#Handling%20of%20descendantCount%20in%20case%20of%20unexpected%20process%20interruption
    const nToIncreaseForOperationInterruption = 1;
    await Page.incrementDescendantCountOfPageIds(
      [newParent?._id],
      nToIncreaseForOperationInterruption,
    );

    // create page redirect
    if (options.createRedirectPage) {
      await PageRedirect.create({ fromPath: page.path, toPath: newPagePath });
    }
    this.pageEvent.emit('rename');

    // Set to Sub
    const pageOp = await PageOperation.findByIdAndUpdatePageActionStage(
      pageOpId,
      PageActionStage.Sub,
    );
    if (pageOp == null) {
      throw Error('PageOperation document not found');
    }

    /*
     * Sub Operation
     */
    this.renameSubOperation(
      page,
      newPagePath,
      user,
      options,
      renamedPage,
      pageOp._id,
      activity,
    );

    return renamedPage;
  }

  async renameSubOperation(
    page,
    newPagePath: string,
    user,
    options,
    renamedPage,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const exParentId = page.parent;

    const timerObj =
      this.crowi.pageOperationService.autoUpdateExpiryDate(pageOpId);
    try {
      // update descendants first
      const descendantsSubscribedSets = new Set();
      await this.renameDescendantsWithStream(
        page,
        newPagePath,
        user,
        options,
        false,
        descendantsSubscribedSets,
      );
      const descendantsSubscribedUsers = Array.from(
        descendantsSubscribedSets,
      ) as Ref<IUser>[];

      const preNotify = preNotifyService.generatePreNotify(
        activity,
        async () => {
          return descendantsSubscribedUsers;
        },
      );

      this.activityEvent.emit('updated', activity, page, preNotify);
    } catch (err) {
      logger.warn(err);
      throw Error(err);
    } finally {
      this.crowi.pageOperationService.clearAutoUpdateInterval(timerObj);
    }

    // reduce parent's descendantCount
    // see: https://dev.growi.org/62149d019311629d4ecd91cf#Handling%20of%20descendantCount%20in%20case%20of%20unexpected%20process%20interruption
    const nToReduceForOperationInterruption = -1;
    await Page.incrementDescendantCountOfPageIds(
      [renamedPage.parent],
      nToReduceForOperationInterruption,
    );

    const nToReduce = -1 * ((page.isEmpty ? 0 : 1) + page.descendantCount);
    await this.updateDescendantCountOfAncestors(exParentId, nToReduce, true);

    // increase ancestore's descendantCount
    const nToIncrease = (renamedPage.isEmpty ? 0 : 1) + page.descendantCount;
    await this.updateDescendantCountOfAncestors(
      renamedPage._id,
      nToIncrease,
      false,
    );

    // Remove leaf empty pages if not moving to under the ex-target position
    if (!this.isRenamingToUnderTarget(page.path, newPagePath)) {
      // remove empty pages at leaf position
      await Page.removeLeafEmptyPagesRecursively(page.parent);
    }

    await PageOperation.findByIdAndDelete(pageOpId);
  }

  async resumeRenameSubOperation(
    renamedPage: PageDocument,
    pageOp: PageOperationDocument,
    activity?,
  ): Promise<void> {
    const isProcessable = pageOp.isProcessable();
    if (!isProcessable) {
      throw Error('This page operation is currently being processed');
    }
    if (pageOp.toPath == null) {
      throw Error(
        `Property toPath is missing which is needed to resume rename operation(${pageOp._id})`,
      );
    }

    const { page, fromPath, toPath, options, user } = pageOp;

    this.fixPathsAndDescendantCountOfAncestors(
      page,
      user,
      options,
      renamedPage,
      pageOp._id,
      fromPath,
      toPath,
      activity,
    );
  }

  /**
   * Renaming paths and fixing descendantCount of ancestors. It shoud be run synchronously.
   * `renameSubOperation` to restart rename operation
   * `updateDescendantCountOfPagesWithPaths` to fix descendantCount of ancestors
   */
  private async fixPathsAndDescendantCountOfAncestors(
    page,
    user,
    options,
    renamedPage,
    pageOpId,
    fromPath,
    toPath,
    activity?,
  ): Promise<void> {
    await this.renameSubOperation(
      page,
      toPath,
      user,
      options,
      renamedPage,
      pageOpId,
      activity,
    );
    const ancestorsPaths =
      this.crowi.pageOperationService.getAncestorsPathsByFromAndToPath(
        fromPath,
        toPath,
      );
    await this.updateDescendantCountOfPagesWithPaths(ancestorsPaths);
  }

  private isRenamingToUnderTarget(fromPath: string, toPath: string): boolean {
    const pathToTest = escapeStringRegexp(addTrailingSlash(fromPath));
    const pathToBeTested = toPath;

    return new RegExp(`^${pathToTest}`, 'i').test(pathToBeTested);
  }

  private async getParentAndforceCreateEmptyTree(originalPage, toPath: string) {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const fromPath = originalPage.path;
    const newParentPath = pathlib.dirname(toPath);

    // local util
    const collectAncestorPathsUntilFromPath = (
      path: string,
      paths: string[] = [],
    ): string[] => {
      if (path === fromPath) return paths;

      const parentPath = pathlib.dirname(path);
      paths.push(parentPath);
      return collectAncestorPathsUntilFromPath(parentPath, paths);
    };

    const pathsToInsert = collectAncestorPathsUntilFromPath(toPath);
    const originalParent = await Page.findById(originalPage.parent);
    if (originalParent == null) {
      throw Error('Original parent not found');
    }
    const insertedPages = await Page.insertMany(
      pathsToInsert.map((path) => {
        return {
          path,
          isEmpty: true,
        };
      }),
    );

    const pages = [...insertedPages, originalParent];

    const ancestorsMap = new Map<string, PageDocument & { _id: any }>(
      pages.map((p) => [p.path, p]),
    );

    // bulkWrite to update ancestors
    const operations = insertedPages.map((page) => {
      const parentPath = pathlib.dirname(page.path);
      const op = {
        updateOne: {
          filter: {
            _id: page._id,
          },
          update: {
            $set: {
              parent: ancestorsMap.get(parentPath)?._id,
              descedantCount: originalParent.descendantCount,
            },
          },
        },
      };

      return op;
    });
    await Page.bulkWrite(operations);

    const newParent = ancestorsMap.get(newParentPath);
    return newParent;
  }

  private async renamePageV4(page, newPagePath, user, options) {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );
    const {
      isRecursively = false,
      createRedirectPage = false,
      updateMetadata = false,
    } = options;

    // sanitize path
    newPagePath = generalXssFilter.process(newPagePath); // eslint-disable-line no-param-reassign

    // create descendants first
    if (isRecursively) {
      await this.renameDescendantsWithStream(page, newPagePath, user, options);
    }

    const update: any = {};
    // update Page
    update.path = newPagePath;
    if (updateMetadata) {
      update.lastUpdateUser = user;
      update.updatedAt = Date.now();
    }
    const renamedPage = await Page.findByIdAndUpdate(
      page._id,
      { $set: update },
      { new: true },
    );

    // update Rivisions
    if (renamedPage == null) {
      throw new Error('Failed to rename page');
    }
    await Revision.updateRevisionListByPageId(renamedPage._id, {
      pageId: renamedPage._id,
    });

    if (createRedirectPage) {
      await PageRedirect.create({ fromPath: page.path, toPath: newPagePath });
    }

    this.pageEvent.emit('rename');

    return renamedPage;
  }

  private async renameDescendants(
    pages,
    user,
    options,
    oldPagePathPrefix,
    newPagePathPrefix,
    shouldUseV4Process = true,
  ) {
    // v4 compatible process
    if (shouldUseV4Process) {
      return this.renameDescendantsV4(
        pages,
        user,
        options,
        oldPagePathPrefix,
        newPagePathPrefix,
      );
    }

    const Page = mongoose.model('Page') as unknown as PageModel;

    const { updateMetadata, createRedirectPage } = options;

    const updatePathOperations: any[] = [];
    const insertPageRedirectOperations: any[] = [];

    pages.forEach((page) => {
      const newPagePath = page.path.replace(
        oldPagePathPrefix,
        newPagePathPrefix,
      );

      // increment updatePathOperations
      const update =
        !page.isEmpty && updateMetadata
          ? {
              $set: {
                path: newPagePath,
                lastUpdateUser: user._id,
                updatedAt: new Date(),
              },
            }
          : {
              $set: { path: newPagePath },
            };

      if (!page.isEmpty && createRedirectPage) {
        // insert PageRedirect
        insertPageRedirectOperations.push({
          insertOne: {
            document: {
              fromPath: page.path,
              toPath: newPagePath,
            },
          },
        });
      }

      updatePathOperations.push({
        updateOne: {
          filter: {
            _id: page._id,
          },
          update,
        },
      });
    });

    try {
      await Page.bulkWrite(updatePathOperations);
    } catch (err) {
      if (err.code !== 11000) {
        throw new Error(`Failed to rename pages: ${err}`);
      }
    }

    try {
      await PageRedirect.bulkWrite(insertPageRedirectOperations);
    } catch (err) {
      if (err.code !== 11000) {
        throw Error(`Failed to create PageRedirect documents: ${err}`);
      }
    }

    this.pageEvent.emit('updateMany', pages, user);
  }

  private async renameDescendantsV4(
    pages,
    user,
    options,
    oldPagePathPrefix,
    newPagePathPrefix,
  ) {
    const pageCollection = mongoose.connection.collection('pages');
    const { updateMetadata, createRedirectPage } = options;

    const unorderedBulkOp = pageCollection.initializeUnorderedBulkOp();
    const insertPageRedirectOperations: any[] = [];

    pages.forEach((page) => {
      const newPagePath = page.path.replace(
        oldPagePathPrefix,
        newPagePathPrefix,
      );

      if (updateMetadata) {
        unorderedBulkOp.find({ _id: page._id }).update({
          $set: {
            path: newPagePath,
            lastUpdateUser: user._id,
            updatedAt: new Date(),
          },
        });
      } else {
        unorderedBulkOp
          .find({ _id: page._id })
          .update({ $set: { path: newPagePath } });
      }
      // insert PageRedirect
      if (!page.isEmpty && createRedirectPage) {
        insertPageRedirectOperations.push({
          insertOne: {
            document: {
              fromPath: page.path,
              toPath: newPagePath,
            },
          },
        });
      }
    });

    try {
      await unorderedBulkOp.execute();
    } catch (err) {
      if (err.code !== 11000) {
        throw new Error(`Failed to rename pages: ${err}`);
      }
    }

    try {
      await PageRedirect.bulkWrite(insertPageRedirectOperations);
    } catch (err) {
      if (err.code !== 11000) {
        throw Error(`Failed to create PageRedirect documents: ${err}`);
      }
    }

    this.pageEvent.emit('updateMany', pages, user);
  }

  private async renameDescendantsWithStream(
    targetPage,
    newPagePath,
    user,
    options = {},
    shouldUseV4Process = true,
    descendantsSubscribedSets?,
  ) {
    // v4 compatible process
    if (shouldUseV4Process) {
      return this.renameDescendantsWithStreamV4(
        targetPage,
        newPagePath,
        user,
        options,
      );
    }

    const factory = new PageCursorsForDescendantsFactory(
      user,
      targetPage,
      true,
    );
    const readStream = await factory.generateReadable();

    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    const newPagePathPrefix = newPagePath;
    const pathRegExp = new RegExp(
      `^${escapeStringRegexp(targetPage.path)}`,
      'i',
    );

    const renameDescendants = this.renameDescendants.bind(this);
    const pageEvent = this.pageEvent;
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await renameDescendants(
            batch,
            user,
            options,
            pathRegExp,
            newPagePathPrefix,
            shouldUseV4Process,
          );
          const subscribedUsers = await Subscription.getSubscriptions(batch);
          subscribedUsers.forEach((eachUser) => {
            descendantsSubscribedSets.add(eachUser);
          });
          logger.debug(`Renaming pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('Renaming error on add anyway: ', err);
        }

        callback();
      },
      async final(callback) {
        logger.debug(`Renaming pages has completed: (totalCount=${count})`);

        // update path
        targetPage.path = newPagePath;
        pageEvent.emit('syncDescendantsUpdate', targetPage, user);

        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);
  }

  private async renameDescendantsWithStreamV4(
    targetPage,
    newPagePath,
    user,
    options = {},
  ) {
    const readStream = await this.generateReadStreamToOperateOnlyDescendants(
      targetPage.path,
      user,
    );
    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    const newPagePathPrefix = newPagePath;
    const pathRegExp = new RegExp(
      `^${escapeStringRegexp(targetPage.path)}`,
      'i',
    );

    const renameDescendants = this.renameDescendants.bind(this);
    const pageEvent = this.pageEvent;
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await renameDescendants(
            batch,
            user,
            options,
            pathRegExp,
            newPagePathPrefix,
          );
          logger.debug(`Renaming pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('renameDescendants error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Renaming pages has completed: (totalCount=${count})`);
        // update  path
        targetPage.path = newPagePath;
        pageEvent.emit('syncDescendantsUpdate', targetPage, user);
        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);
  }

  /*
   * Duplicate
   */
  async duplicate(
    page: PageDocument,
    newPagePath: string,
    user,
    isRecursively: boolean,
    onlyDuplicateUserRelatedResources: boolean,
  ) {
    /*
     * Common Operation
     */
    const isEmptyAndNotRecursively = page?.isEmpty && !isRecursively;
    if (page == null || isEmptyAndNotRecursively) {
      throw new Error('Cannot find or duplicate the empty page');
    }

    const Page = mongoose.model('Page') as unknown as PageModel;

    if (!isRecursively && page.isEmpty) {
      throw Error('Page not found.');
    }

    newPagePath = generalXssFilter.process(newPagePath); // eslint-disable-line no-param-reassign

    // 1. Separate v4 & v5 process
    const isShouldUseV4Process = shouldUseV4Process(page);
    if (isShouldUseV4Process) {
      return this.duplicateV4(
        page,
        newPagePath,
        user,
        isRecursively,
        onlyDuplicateUserRelatedResources,
      );
    }

    const canOperate = await this.crowi.pageOperationService.canOperate(
      isRecursively,
      page.path,
      newPagePath,
    );
    if (!canOperate) {
      throw Error(
        `Cannot operate duplicate to path "${newPagePath}" right now.`,
      );
    }

    // 2. UserGroup & Owner validation
    // use the parent's grant when target page is an empty page
    let grant: PageGrant;
    let grantedUserIds: ObjectIdLike[] | undefined;
    let grantedGroupIds: IGrantedGroup[];

    if (page.isEmpty) {
      const parent = await Page.findOne({ _id: page.parent });
      if (parent == null) {
        throw Error('parent not found');
      }
      grant = parent.grant;
      grantedUserIds = parent.grantedUsers.map((u) => getIdForRef(u));
      grantedGroupIds = onlyDuplicateUserRelatedResources
        ? await this.pageGrantService.getUserRelatedGrantedGroups(parent, user)
        : parent.grantedGroups;
    } else {
      grant = page.grant;
      grantedUserIds = page.grantedUsers.map((u) => getIdForRef(u));
      grantedGroupIds = onlyDuplicateUserRelatedResources
        ? await this.pageGrantService.getUserRelatedGrantedGroups(page, user)
        : page.grantedGroups;
    }

    if (grant !== Page.GRANT_RESTRICTED) {
      let isGrantNormalized = false;
      try {
        isGrantNormalized = await this.pageGrantService.isGrantNormalized(
          user,
          newPagePath,
          grant,
          grantedUserIds,
          grantedGroupIds,
          false,
        );
      } catch (err) {
        logger.error(
          `Failed to validate grant of page at "${newPagePath}" when duplicating`,
          err,
        );
        throw err;
      }
      if (!isGrantNormalized) {
        throw Error(
          `This page cannot be duplicated to "${newPagePath}" since the selected grant or grantedGroup is not assignable to this page.`,
        );
      }
    }

    // copy & populate (reason why copy: SubOperation only allows non-populated page document)
    const copyPage = { ...page };

    // 3. Duplicate target
    const options: IOptionsForCreate = {
      grant,
      grantUserGroupIds: grantedGroupIds,
    };
    let duplicatedTarget: HydratedDocument<PageDocument>;
    if (page.isEmpty) {
      const parent = await this.getParentAndFillAncestorsByUser(
        user,
        newPagePath,
      );
      duplicatedTarget = await Page.createEmptyPage(newPagePath, parent);
    } else {
      const populatedPage = await page.populate<{
        revision: IRevisionHasId | null;
      }>({ path: 'revision', model: 'Revision', select: 'body' });
      duplicatedTarget = await (this.create as CreateMethod)(
        newPagePath,
        populatedPage?.revision?.body ?? '',
        user,
        options,
      );

      if (isAiEnabled()) {
        const { getOpenaiService } = await import(
          '~/features/openai/server/services/openai'
        );
        const openaiService = getOpenaiService();
        // Do not await because communication with OpenAI takes time
        openaiService?.createVectorStoreFileOnPageCreate([duplicatedTarget]);
      }
    }
    this.pageEvent.emit('duplicate', page, user);

    // 4. Take over tags
    const originTags = await page.findRelatedTagsById();
    let savedTags: PageTagRelationDocument[] = [];
    if (originTags.length !== 0) {
      await PageTagRelation.updatePageTags(duplicatedTarget._id, originTags);
      savedTags = await PageTagRelation.listTagNamesByPage(
        duplicatedTarget._id,
      );
      this.tagEvent.emit('update', duplicatedTarget, savedTags);
    }

    if (isRecursively) {
      /*
       * Resumable Operation
       */
      let pageOp: PageOperationDocument;
      try {
        pageOp = await PageOperation.create({
          actionType: PageActionType.Duplicate,
          actionStage: PageActionStage.Main,
          page: copyPage,
          user,
          fromPath: page.path,
          toPath: newPagePath,
        });
      } catch (err) {
        logger.error('Failed to create PageOperation document.', err);
        throw err;
      }

      (async () => {
        try {
          await this.duplicateRecursivelyMainOperation(
            page,
            newPagePath,
            user,
            pageOp._id,
            onlyDuplicateUserRelatedResources,
          );
        } catch (err) {
          logger.error(
            'Error occurred while running duplicateRecursivelyMainOperation.',
            err,
          );

          // cleanup
          await PageOperation.deleteOne({ _id: pageOp._id });

          throw err;
        }
      })();
    }

    const result = serializePageSecurely(duplicatedTarget);
    result.tags = savedTags;
    return result;
  }

  async duplicateRecursivelyMainOperation(
    page: PageDocument,
    newPagePath: string,
    user,
    pageOpId: ObjectIdLike,
    onlyDuplicateUserRelatedResources: boolean,
  ): Promise<void> {
    const nDuplicatedPages = await this.duplicateDescendantsWithStream(
      page,
      newPagePath,
      user,
      onlyDuplicateUserRelatedResources,
      false,
    );

    // normalize parent of descendant pages
    const shouldNormalize = this.shouldNormalizeParent(page);
    if (shouldNormalize) {
      try {
        await this.normalizeParentAndDescendantCountOfDescendants(
          newPagePath,
          user,
          true,
        );
        logger.info(
          `Successfully normalized duplicated descendant pages under "${newPagePath}"`,
        );
      } catch (err) {
        logger.error('Failed to normalize descendants afrer duplicate:', err);
        throw err;
      }
    }

    // Set to Sub
    const pageOp = await PageOperation.findByIdAndUpdatePageActionStage(
      pageOpId,
      PageActionStage.Sub,
    );
    if (pageOp == null) {
      throw Error('PageOperation document not found');
    }

    /*
     * Sub Operation
     */
    await this.duplicateRecursivelySubOperation(
      newPagePath,
      nDuplicatedPages,
      pageOp._id,
    );
  }

  async duplicateRecursivelySubOperation(
    newPagePath: string,
    nDuplicatedPages: number,
    pageOpId: ObjectIdLike,
  ): Promise<void> {
    const Page = mongoose.model('Page');
    const newTarget = await Page.findOne({ path: newPagePath }); // only one page will be found since duplicating to existing path is forbidden
    if (newTarget == null) {
      throw Error(
        'No duplicated page found. Something might have gone wrong in duplicateRecursivelyMainOperation.',
      );
    }

    await this.updateDescendantCountOfAncestors(
      newTarget._id,
      nDuplicatedPages,
      false,
    );

    await PageOperation.findByIdAndDelete(pageOpId);
  }

  async duplicateV4(
    page,
    newPagePath,
    user,
    isRecursively,
    onlyDuplicateUserRelatedResources: boolean,
  ) {
    // populate
    await page.populate({
      path: 'revision',
      model: 'Revision',
      select: 'body',
    });

    // create option
    const options: any = { page };
    options.grant = page.grant;
    options.grantUserGroupIds = page.grantedGroups;
    options.grantedUserIds = page.grantedUsers;

    newPagePath = generalXssFilter.process(newPagePath); // eslint-disable-line no-param-reassign

    const createdPage = await this.create(
      newPagePath,
      page.revision.body,
      user,
      options,
    );
    this.pageEvent.emit('duplicate', page, user);

    if (isRecursively) {
      this.duplicateDescendantsWithStream(
        page,
        newPagePath,
        user,
        onlyDuplicateUserRelatedResources,
      );
    }

    // take over tags
    const originTags = await page.findRelatedTagsById();
    let savedTags: PageTagRelationDocument[] = [];
    if (originTags != null) {
      await PageTagRelation.updatePageTags(createdPage.id, originTags);
      savedTags = await PageTagRelation.listTagNamesByPage(createdPage.id);
      this.tagEvent.emit('update', createdPage, savedTags);
    }
    const result = serializePageSecurely(createdPage);
    result.tags = savedTags;

    return result;
  }

  /**
   * Receive the object with oldPageId and newPageId and duplicate the tags from oldPage to newPage
   * @param {Object} pageIdMapping e.g. key: oldPageId, value: newPageId
   */
  private async duplicateTags(pageIdMapping) {
    // convert pageId from string to ObjectId
    const pageIds = Object.keys(pageIdMapping);
    const stage = {
      $or: pageIds.map((pageId) => {
        return { relatedPage: new mongoose.Types.ObjectId(pageId) };
      }),
    };

    const pagesAssociatedWithTag = await PageTagRelation.aggregate([
      {
        $match: stage,
      },
      {
        $group: {
          _id: '$relatedTag',
          relatedPages: { $push: '$relatedPage' },
        },
      },
    ]);

    const newPageTagRelation: any[] = [];
    pagesAssociatedWithTag.forEach(({ _id, relatedPages }) => {
      // relatedPages
      relatedPages.forEach((pageId) => {
        newPageTagRelation.push({
          relatedPage: pageIdMapping[pageId], // newPageId
          relatedTag: _id,
        });
      });
    });

    return PageTagRelation.insertMany(newPageTagRelation, { ordered: false });
  }

  private async duplicateDescendants(
    pages,
    user,
    oldPagePathPrefix,
    newPagePathPrefix,
    onlyDuplicateUserRelatedResources: boolean,
    shouldUseV4Process = true,
  ) {
    if (shouldUseV4Process) {
      return this.duplicateDescendantsV4(
        pages,
        user,
        oldPagePathPrefix,
        newPagePathPrefix,
      );
    }

    const Page = mongoose.model<PageDocument, PageModel>('Page');

    const pageIds = pages.map((page) => page._id);
    const revisions = await Revision.find({ pageId: { $in: pageIds } });

    // Mapping to set to the body of the new revision
    const pageIdRevisionMapping: Record<string, IRevisionDocument> = {};
    revisions.forEach((revision) => {
      pageIdRevisionMapping[getIdStringForRef(revision.pageId)] = revision;
    });

    // key: oldPageId, value: newPageId
    const pageIdMapping = {};
    const newPages: any[] = [];
    const newRevisions: any[] = [];

    const userRelatedGroups =
      await this.pageGrantService.getUserRelatedGroups(user);

    // no need to save parent here
    pages.forEach((page) => {
      const newPageId = new mongoose.Types.ObjectId();
      const newPagePath = page.path.replace(
        oldPagePathPrefix,
        newPagePathPrefix,
      );
      const revisionId = new mongoose.Types.ObjectId();
      pageIdMapping[page._id] = newPageId;

      const isDuplicateTarget =
        !page.isEmpty &&
        (!onlyDuplicateUserRelatedResources ||
          this.pageGrantService.isUserGrantedPageAccess(
            page,
            user,
            userRelatedGroups,
          ));

      if (isDuplicateTarget) {
        const grantedGroups = onlyDuplicateUserRelatedResources
          ? this.pageGrantService.getUserRelatedGrantedGroupsSyncronously(
              userRelatedGroups,
              page,
            )
          : page.grantedGroups;
        const newPage = {
          _id: newPageId,
          path: newPagePath,
          creator: user._id,
          grant: page.grant,
          grantedGroups,
          grantedUsers: page.grantedUsers,
          lastUpdateUser: user._id,
          revision: revisionId,
        };
        newRevisions.push({
          _id: revisionId,
          pageId: newPageId,
          body: pageIdRevisionMapping[page._id.toString()].body,
          author: user._id,
          format: 'markdown',
        });
        newPages.push(newPage);
      }
    });

    const duplicatedPages = await Page.insertMany(newPages, { ordered: false });
    const duplicatedPageIds = duplicatedPages.map(
      (duplicatedPage) => duplicatedPage._id,
    );

    await Revision.insertMany(newRevisions, { ordered: false });
    await this.duplicateTags(pageIdMapping);

    const duplicatedPagesWithPopulatedToShowRevision: HydratedDocument<PageDocument>[] =
      await Page.find({
        _id: { $in: duplicatedPageIds },
        grant: PageGrant.GRANT_PUBLIC,
      }).populate('revision');

    if (isAiEnabled()) {
      const { getOpenaiService } = await import(
        '~/features/openai/server/services/openai'
      );
      const openaiService = getOpenaiService();
      // Do not await because communication with OpenAI takes time
      openaiService?.createVectorStoreFileOnPageCreate(
        duplicatedPagesWithPopulatedToShowRevision,
      );
    }
  }

  private async duplicateDescendantsV4(
    pages,
    user,
    oldPagePathPrefix,
    newPagePathPrefix,
  ) {
    const Page = this.crowi.model('Page');

    const pageIds = pages.map((page) => page._id);
    const revisions = await Revision.find({ pageId: { $in: pageIds } });

    // Mapping to set to the body of the new revision
    const pageIdRevisionMapping: Record<string, IRevisionDocument> = {};
    revisions.forEach((revision) => {
      pageIdRevisionMapping[getIdStringForRef(revision.pageId)] = revision;
    });

    // key: oldPageId, value: newPageId
    const pageIdMapping = {};
    const newPages: any[] = [];
    const newRevisions: any[] = [];

    pages.forEach((page) => {
      const newPageId = new mongoose.Types.ObjectId();
      const newPagePath = page.path.replace(
        oldPagePathPrefix,
        newPagePathPrefix,
      );
      const revisionId = new mongoose.Types.ObjectId();
      pageIdMapping[page._id] = newPageId;

      newPages.push({
        _id: newPageId,
        path: newPagePath,
        creator: user._id,
        grant: page.grant,
        grantedGroups: page.grantedGroups,
        grantedUsers: page.grantedUsers,
        lastUpdateUser: user._id,
        revision: revisionId,
      });

      newRevisions.push({
        _id: revisionId,
        pageId: newPageId,
        body: pageIdRevisionMapping[page._id.toString()].body,
        author: user._id,
        format: 'markdown',
      });
    });

    await Page.insertMany(newPages, { ordered: false });
    await Revision.insertMany(newRevisions, { ordered: false });
    await this.duplicateTags(pageIdMapping);
  }

  private async duplicateDescendantsWithStream(
    page,
    newPagePath,
    user,
    onlyDuplicateUserRelatedResources: boolean,
    shouldUseV4Process = true,
  ) {
    if (shouldUseV4Process) {
      return this.duplicateDescendantsWithStreamV4(
        page,
        newPagePath,
        user,
        onlyDuplicateUserRelatedResources,
      );
    }

    const iterableFactory = new PageCursorsForDescendantsFactory(
      user,
      page,
      true,
    );
    const readStream = await iterableFactory.generateReadable();
    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    const newPagePathPrefix = newPagePath;
    const pathRegExp = new RegExp(`^${escapeStringRegexp(page.path)}`, 'i');

    const duplicateDescendants = this.duplicateDescendants.bind(this);
    const pageEvent = this.pageEvent;
    let count = 0;
    let nNonEmptyDuplicatedPages = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          nNonEmptyDuplicatedPages += batch.filter(
            (page) => !page.isEmpty,
          ).length;
          await duplicateDescendants(
            batch,
            user,
            pathRegExp,
            newPagePathPrefix,
            onlyDuplicateUserRelatedResources,
            shouldUseV4Process,
          );
          logger.debug(`Adding pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        callback();
      },
      async final(callback) {
        logger.debug(`Adding pages has completed: (totalCount=${count})`);
        // update  path
        page.path = newPagePath;
        pageEvent.emit('syncDescendantsUpdate', page, user);
        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);

    return nNonEmptyDuplicatedPages;
  }

  private async duplicateDescendantsWithStreamV4(
    page,
    newPagePath,
    user,
    onlyDuplicateUserRelatedResources: boolean,
  ) {
    const readStream = await this.generateReadStreamToOperateOnlyDescendants(
      page.path,
      user,
    );
    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    const newPagePathPrefix = newPagePath;
    const pathRegExp = new RegExp(`^${escapeStringRegexp(page.path)}`, 'i');

    const duplicateDescendants = this.duplicateDescendants.bind(this);
    const pageEvent = this.pageEvent;
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await duplicateDescendants(
            batch,
            user,
            pathRegExp,
            newPagePathPrefix,
            onlyDuplicateUserRelatedResources,
          );
          logger.debug(`Adding pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Adding pages has completed: (totalCount=${count})`);
        // update  path
        page.path = newPagePath;
        pageEvent.emit('syncDescendantsUpdate', page, user);
        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);

    return count;
  }

  /*
   * Delete
   */
  async deletePage(
    page,
    user,
    options = {},
    isRecursively = false,
    activityParameters,
  ) {
    /*
     * Common Operation
     */
    const Page = mongoose.model('Page') as PageModel;

    // Separate v4 & v5 process
    const isShouldUseV4Process = shouldUseV4Process(page);
    if (isShouldUseV4Process) {
      return this.deletePageV4(page, user, options, isRecursively);
    }
    // Validate
    if (page.isEmpty && !isRecursively) {
      throw Error('Page not found.');
    }
    const isTrashed = isTrashPage(page.path);
    if (isTrashed) {
      throw new Error('This method does NOT support deleting trashed pages.');
    }

    if (isTopPage(page.path) || isUsersTopPage(page.path)) {
      throw new Error('Page is not deletable.');
    }

    if (pagePathUtils.isUsersHomepage(page.path)) {
      if (!this.canDeleteUserHomepageByConfig()) {
        throw new Error('User Homepage is not deletable.');
      }
      if (!(await this.isUsersHomepageOwnerAbsent(page.path))) {
        throw new Error('User Homepage is not deletable.');
      }
    }

    const newPath = Page.getDeletedPageName(page.path);

    const canOperate = await this.crowi.pageOperationService.canOperate(
      isRecursively,
      page.path,
      newPath,
    );
    if (!canOperate) {
      throw Error(`Cannot operate delete to path "${newPath}" right now.`);
    }

    // Replace with an empty page
    const isChildrenExist = await Page.exists({ parent: page._id });
    const shouldReplace = !isRecursively && isChildrenExist;
    if (shouldReplace) {
      await Page.replaceTargetWithPage(page, null, true);
    }

    const parameters = {
      ip: activityParameters.ip,
      endpoint: activityParameters.endpoint,
      action:
        page.descendantCount > 0
          ? SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE
          : SupportedAction.ACTION_PAGE_DELETE,
      user,
      target: page,
      targetModel: 'Page',
      snapshot: {
        username: user.username,
      },
    };

    const activity =
      await this.crowi.activityService.createActivity(parameters);

    // Delete target (only updating an existing document's properties )
    let deletedPage: PageDocument | null;
    if (!page.isEmpty) {
      deletedPage = await this.deleteNonEmptyTarget(page, user);
    } else {
      // always recursive
      deletedPage = page;
      await Page.deleteOne({ _id: page._id, isEmpty: true });
    }

    // 1. Update descendantCount
    if (isRecursively) {
      const inc = page.isEmpty
        ? -page.descendantCount
        : -(page.descendantCount + 1);
      await this.updateDescendantCountOfAncestors(page.parent, inc, true);
    } else {
      // update descendantCount of ancestors'
      await this.updateDescendantCountOfAncestors(page.parent, -1, true);
    }
    // 2. Delete leaf empty pages
    await Page.removeLeafEmptyPagesRecursively(page.parent);

    if (isRecursively) {
      let pageOp: PageOperationDocument;
      try {
        pageOp = await PageOperation.create({
          actionType: PageActionType.Delete,
          actionStage: PageActionStage.Main,
          page,
          user,
          fromPath: page.path,
          toPath: newPath,
        });
      } catch (err) {
        logger.error('Failed to create PageOperation document.', err);
        throw err;
      }
      /*
       * Resumable Operation
       */
      (async () => {
        try {
          await this.deleteRecursivelyMainOperation(
            page,
            user,
            pageOp._id,
            activity,
          );
        } catch (err) {
          logger.error(
            'Error occurred while running deleteRecursivelyMainOperation.',
            err,
          );

          // cleanup
          await PageOperation.deleteOne({ _id: pageOp._id });

          throw err;
        } finally {
          this.pageEvent.emit('syncDescendantsUpdate', deletedPage, user);
        }
      })();
    } else {
      const preNotify = preNotifyService.generatePreNotify(activity);

      this.activityEvent.emit('updated', activity, page, preNotify);
    }

    return deletedPage;
  }

  private async deleteNonEmptyTarget(page, user) {
    const Page = mongoose.model('Page') as unknown as PageModel;
    const newPath = Page.getDeletedPageName(page.path);

    const deletedPage = await Page.findByIdAndUpdate(
      page._id,
      {
        $set: {
          path: newPath,
          status: Page.STATUS_DELETED,
          deleteUser: user._id,
          deletedAt: Date.now(),
          parent: null,
          descendantCount: 0, // set parent as null
        },
      },
      { new: true },
    );

    await PageTagRelation.updateMany(
      { relatedPage: page._id },
      { $set: { isPageTrashed: true } },
    );
    try {
      await PageRedirect.create({ fromPath: page.path, toPath: newPath });
    } catch (err) {
      if (err.code !== 11000) {
        throw err;
      }
    }
    this.pageEvent.emit('delete', page, deletedPage, user);

    return deletedPage;
  }

  async deleteRecursivelyMainOperation(
    page,
    user,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void> {
    const descendantsSubscribedSets = new Set();
    await this.deleteDescendantsWithStream(
      page,
      user,
      false,
      descendantsSubscribedSets,
    );

    const descendantsSubscribedUsers = Array.from(
      descendantsSubscribedSets,
    ) as Ref<IUser>[];

    const preNotify = preNotifyService.generatePreNotify(activity, async () => {
      return descendantsSubscribedUsers;
    });

    this.activityEvent.emit('updated', activity, page, preNotify);

    await PageOperation.findByIdAndDelete(pageOpId);

    // no sub operation available
  }

  private async deletePageV4(
    page: HydratedDocument<PageDocument>,
    user,
    options = {},
    isRecursively = false,
  ) {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    const newPath = Page.getDeletedPageName(page.path);
    const isTrashed = isTrashPage(page.path);

    if (isTrashed) {
      throw new Error('This method does NOT support deleting trashed pages.');
    }

    if (!isMovablePage(page.path)) {
      throw new Error('Page is not deletable.');
    }

    if (isRecursively) {
      this.deleteDescendantsWithStream(page, user);
    }

    // update Revisions
    await Revision.updateRevisionListByPageId(page._id, { pageId: page._id });
    const deletedPage = await Page.findByIdAndUpdate(
      page._id,
      {
        $set: {
          path: newPath,
          status: Page.STATUS_DELETED,
          deleteUser: user._id,
          deletedAt: Date.now(),
        },
      },
      { new: true },
    );
    await PageTagRelation.updateMany(
      { relatedPage: page._id },
      { $set: { isPageTrashed: true } },
    );

    try {
      await PageRedirect.create({ fromPath: page.path, toPath: newPath });
    } catch (err) {
      if (err.code !== 11000) {
        throw err;
      }
    }

    this.pageEvent.emit('delete', page, deletedPage, user);

    return deletedPage;
  }

  private async deleteDescendants(pages, user) {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const deletePageOperations: any[] = [];
    const insertPageRedirectOperations: any[] = [];

    pages.forEach((page) => {
      const newPath = Page.getDeletedPageName(page.path);

      const operation = page.isEmpty
        ? {
            deleteOne: {
              filter: { _id: page._id },
            },
          }
        : {
            updateOne: {
              filter: { _id: page._id },
              update: {
                $set: {
                  path: newPath,
                  status: Page.STATUS_DELETED,
                  deleteUser: user._id,
                  deletedAt: Date.now(),
                  parent: null,
                  descendantCount: 0, // set parent as null
                },
              },
            },
          };

      if (!page.isEmpty) {
        insertPageRedirectOperations.push({
          insertOne: {
            document: {
              fromPath: page.path,
              toPath: newPath,
            },
          },
        });
      }

      deletePageOperations.push(operation);
    });

    try {
      await Page.bulkWrite(deletePageOperations);
    } catch (err) {
      if (err.code !== 11000) {
        throw new Error(`Failed to delete pages: ${err}`);
      }
    } finally {
      this.pageEvent.emit('syncDescendantsDelete', pages, user);
    }

    try {
      await PageRedirect.bulkWrite(insertPageRedirectOperations);
    } catch (err) {
      if (err.code !== 11000) {
        throw Error(`Failed to create PageRedirect documents: ${err}`);
      }
    }
  }

  /**
   * Create delete stream and return deleted document count
   */
  private async deleteDescendantsWithStream(
    targetPage,
    user,
    shouldUseV4Process = true,
    descendantsSubscribedSets?,
  ): Promise<number> {
    const readStream = shouldUseV4Process
      ? await this.generateReadStreamToOperateOnlyDescendants(
          targetPage.path,
          user,
        )
      : await new PageCursorsForDescendantsFactory(
          user,
          targetPage,
          true,
        ).generateReadable();

    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    const deleteDescendants = this.deleteDescendants.bind(this);
    let count = 0;
    let nDeletedNonEmptyPages = 0; // used for updating descendantCount

    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        nDeletedNonEmptyPages += batch.filter((d) => !d.isEmpty).length;

        try {
          count += batch.length;
          await deleteDescendants(batch, user);
          const subscribedUsers = await Subscription.getSubscriptions(batch);
          subscribedUsers.forEach((eachUser) => {
            descendantsSubscribedSets.add(eachUser);
          });
          logger.debug(`Deleting pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('deleteDescendants error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Deleting pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);

    return nDeletedNonEmptyPages;
  }

  async deleteCompletelyOperation(pageIds, pagePaths): Promise<void> {
    // Delete Attachments, Revisions, Pages and emit delete
    const Page = this.crowi.model('Page');

    const { attachmentService } = this.crowi;
    const attachments = await Attachment.find({ page: { $in: pageIds } });

    await Promise.all([
      Comment.deleteMany({ page: { $in: pageIds } }),
      PageTagRelation.deleteMany({ relatedPage: { $in: pageIds } }),
      ShareLink.deleteMany({ relatedPage: { $in: pageIds } }),
      Revision.deleteMany({ pageId: { $in: pageIds } }),
      Page.deleteMany({ _id: { $in: pageIds } }),
      PageRedirect.deleteMany({
        $or: [{ fromPath: { $in: pagePaths } }, { toPath: { $in: pagePaths } }],
      }),
      attachmentService.removeAllAttachments(attachments),

      // Leave bookmarks without deleting -- 2024.05.17 Yuki Takei
    ]);

    if (isAiEnabled()) {
      const { getOpenaiService } = await import(
        '~/features/openai/server/services/openai'
      );
      const openaiService = getOpenaiService();
      await openaiService?.deleteVectorStoreFilesByPageIds(pageIds);
    }
  }

  // delete multiple pages
  async deleteMultipleCompletely(pages, user) {
    const ids = pages.map((page) => page._id);
    const paths = pages.map((page) => page.path);

    logger.debug('Deleting completely', paths);

    await this.deleteCompletelyOperation(ids, paths);

    this.pageEvent.emit('syncDescendantsDelete', pages, user); // update as renamed page
    return;
  }

  async deleteCompletely(
    page,
    user,
    options = {},
    isRecursively = false,
    preventEmitting = false,
    activityParameters,
  ) {
    /*
     * Common Operation
     */
    const Page = mongoose.model('Page') as PageModel;

    if (isTopPage(page.path)) {
      throw Error('It is forbidden to delete the top page');
    }

    if (page.isEmpty && !isRecursively) {
      throw Error('Page not found.');
    }

    // v4 compatible process
    const isShouldUseV4Process = shouldUseV4Process(page);
    if (isShouldUseV4Process) {
      return this.deleteCompletelyV4(
        page,
        user,
        options,
        isRecursively,
        preventEmitting,
      );
    }

    const canOperate = await this.crowi.pageOperationService.canOperate(
      isRecursively,
      page.path,
      null,
    );
    if (!canOperate) {
      throw Error(
        `Cannot operate deleteCompletely from path "${page.path}" right now.`,
      );
    }

    const ids = [page._id];
    const paths = [page.path];

    logger.debug('Deleting completely', paths);

    const parameters = {
      ip: activityParameters.ip,
      endpoint: activityParameters.endpoint,
      action:
        page.descendantCount > 0
          ? SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE_COMPLETELY
          : SupportedAction.ACTION_PAGE_DELETE_COMPLETELY,
      user,
      target: page,
      targetModel: 'Page',
      snapshot: {
        username: user.username,
      },
    };

    const activity =
      await this.crowi.activityService.createActivity(parameters);

    // 1. update descendantCount
    if (isRecursively) {
      const inc = page.isEmpty
        ? -page.descendantCount
        : -(page.descendantCount + 1);
      await this.updateDescendantCountOfAncestors(page.parent, inc, true);
    } else {
      // replace with an empty page
      const shouldReplace = await Page.exists({ parent: page._id });
      let pageToUpdateDescendantCount = page;
      if (shouldReplace) {
        pageToUpdateDescendantCount = await Page.replaceTargetWithPage(page);
      }
      await this.updateDescendantCountOfAncestors(
        pageToUpdateDescendantCount.parent,
        -1,
        true,
      );
    }
    // 2. then delete target completely
    await this.deleteCompletelyOperation(ids, paths);

    // delete leaf empty pages
    await Page.removeLeafEmptyPagesRecursively(page.parent);

    if (!page.isEmpty && !preventEmitting) {
      this.pageEvent.emit('deleteCompletely', page, user);
    }

    if (isRecursively) {
      let pageOp: PageOperationDocument;
      try {
        pageOp = await PageOperation.create({
          actionType: PageActionType.DeleteCompletely,
          actionStage: PageActionStage.Main,
          page,
          user,
          fromPath: page.path,
          options,
        });
      } catch (err) {
        logger.error('Failed to create PageOperation document.', err);
        throw err;
      }
      /*
       * Main Operation
       */
      (async () => {
        try {
          await this.deleteCompletelyRecursivelyMainOperation(
            page,
            user,
            options,
            pageOp._id,
            activity,
          );
        } catch (err) {
          logger.error(
            'Error occurred while running deleteCompletelyRecursivelyMainOperation.',
            err,
          );

          // cleanup
          await PageOperation.deleteOne({ _id: pageOp._id });

          throw err;
        }
      })();
    } else {
      const preNotify = preNotifyService.generatePreNotify(activity);

      this.activityEvent.emit('updated', activity, page, preNotify);
    }

    return;
  }

  async deleteCompletelyRecursivelyMainOperation(
    page,
    user,
    options,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void> {
    const descendantsSubscribedSets = new Set();
    await this.deleteCompletelyDescendantsWithStream(
      page,
      user,
      options,
      false,
      descendantsSubscribedSets,
    );
    const descendantsSubscribedUsers = Array.from(
      descendantsSubscribedSets,
    ) as Ref<IUser>[];

    const preNotify = preNotifyService.generatePreNotify(activity, async () => {
      return descendantsSubscribedUsers;
    });

    this.activityEvent.emit('updated', activity, page, preNotify);

    await PageOperation.findByIdAndDelete(pageOpId);

    // no sub operation available
  }

  private async deleteCompletelyV4(
    page,
    user,
    options = {},
    isRecursively = false,
    preventEmitting = false,
  ) {
    const ids = [page._id];
    const paths = [page.path];

    logger.debug('Deleting completely', paths);

    await this.deleteCompletelyOperation(ids, paths);

    if (isRecursively) {
      this.deleteCompletelyDescendantsWithStream(page, user, options);
    }

    if (!page.isEmpty && !preventEmitting) {
      this.pageEvent.emit('deleteCompletely', page, user);
    }

    return;
  }

  async emptyTrashPage(user, options = {}, activityParameters) {
    const page = { path: '/trash' };

    const parameters = {
      ...activityParameters,
      action: SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE_COMPLETELY,
      user,
      targetModel: 'Page',
      snapshot: {
        username: user.username,
      },
    };

    const activity =
      await this.crowi.activityService.createActivity(parameters);

    const descendantsSubscribedSets = new Set();
    const pages = await this.deleteCompletelyDescendantsWithStream(
      page,
      user,
      options,
      true,
      descendantsSubscribedSets,
    );
    const descendantsSubscribedUsers = Array.from(
      descendantsSubscribedSets,
    ) as Ref<IUser>[];

    const preNotify = preNotifyService.generatePreNotify(activity, async () => {
      return descendantsSubscribedUsers;
    });

    this.activityEvent.emit('updated', activity, page, preNotify);

    return pages;
  }

  /**
   * Create delete completely stream
   */
  private async deleteCompletelyDescendantsWithStream(
    targetPage,
    user,
    options = {},
    shouldUseV4Process = true,
    descendantsSubscribedSets?,
  ): Promise<number> {
    const readStream = shouldUseV4Process // pages don't have parents
      ? await this.generateReadStreamToOperateOnlyDescendants(
          targetPage.path,
          user,
        )
      : await new PageCursorsForDescendantsFactory(
          user,
          targetPage,
          true,
        ).generateReadable();

    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    let count = 0;
    let nDeletedNonEmptyPages = 0; // used for updating descendantCount

    const deleteMultipleCompletely = this.deleteMultipleCompletely.bind(this);
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        nDeletedNonEmptyPages += batch.filter((d) => !d.isEmpty).length;

        try {
          count += batch.length;
          await deleteMultipleCompletely(batch, user);
          const subscribedUsers = await Subscription.getSubscriptions(batch);
          subscribedUsers.forEach((eachUser) => {
            descendantsSubscribedSets.add(eachUser);
          });
          logger.debug(`Adding pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Adding pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);

    return nDeletedNonEmptyPages;
  }

  // no need to separate Main Sub since it is devided into single page operations
  async deleteMultiplePages(
    pagesToDelete,
    user,
    options,
    activityParameters,
  ): Promise<void> {
    const { isRecursively, isCompletely } = options;

    if (pagesToDelete.length > LIMIT_FOR_MULTIPLE_PAGE_OP) {
      throw Error(
        `The maximum number of pages is ${LIMIT_FOR_MULTIPLE_PAGE_OP}.`,
      );
    }

    // omit duplicate paths if isRecursively true, omit empty pages if isRecursively false
    const pages = isRecursively
      ? omitDuplicateAreaPageFromPages(pagesToDelete)
      : pagesToDelete.filter((p) => !p.isEmpty);

    if (isCompletely) {
      for await (const page of pages) {
        await this.deleteCompletely(
          page,
          user,
          {},
          isRecursively,
          false,
          activityParameters,
        );
      }
    } else {
      for await (const page of pages) {
        await this.deletePage(
          page,
          user,
          {},
          isRecursively,
          activityParameters,
        );
      }
    }
  }

  // use the same process in both v4 and v5
  private async revertDeletedDescendants(pages, user) {
    const Page = mongoose.model<IPage, PageModel>('Page');

    const revertPageOperations: any[] = [];
    const fromPathsToDelete: string[] = [];

    pages.forEach((page) => {
      // e.g. page.path = /trash/test, toPath = /test
      const toPath = Page.getRevertDeletedPageName(page.path);
      revertPageOperations.push({
        updateOne: {
          filter: { _id: page._id },
          update: {
            $set: {
              path: toPath,
              status: Page.STATUS_PUBLISHED,
              lastUpdateUser: user._id,
              deleteUser: null,
              deletedAt: null,
            },
          },
        },
      });

      fromPathsToDelete.push(page.path);
    });

    try {
      await Page.bulkWrite(revertPageOperations);
      await PageRedirect.deleteMany({ fromPath: { $in: fromPathsToDelete } });
    } catch (err) {
      if (err.code !== 11000) {
        throw new Error(`Failed to revert pages: ${err}`);
      }
    }
  }

  async revertDeletedPage(
    page,
    user,
    options = {},
    isRecursively = false,
    activityParameters?,
  ) {
    /*
     * Common Operation
     */
    const Page = mongoose.model<IPage, PageModel>('Page');

    const parameters = {
      ip: activityParameters.ip,
      endpoint: activityParameters.endpoint,
      action:
        page.descendantCount > 0
          ? SupportedAction.ACTION_PAGE_RECURSIVELY_REVERT
          : SupportedAction.ACTION_PAGE_REVERT,
      user,
      target: page,
      targetModel: 'Page',
      snapshot: {
        username: user.username,
      },
    };

    const activity =
      await this.crowi.activityService.createActivity(parameters);

    // 1. Separate v4 & v5 process
    const shouldUseV4Process = this.shouldUseV4ProcessForRevert(page);
    if (shouldUseV4Process) {
      return this.revertDeletedPageV4(page, user, options, isRecursively);
    }

    const newPath = Page.getRevertDeletedPageName(page.path);

    const canOperate = await this.crowi.pageOperationService.canOperate(
      isRecursively,
      page.path,
      newPath,
    );
    if (!canOperate) {
      throw Error(`Cannot operate revert from path "${page.path}" right now.`);
    }

    const includeEmpty = true;
    const originPage = await Page.findByPath(newPath, includeEmpty);

    // throw if any page already exists when recursively operation
    if (originPage != null && (!originPage.isEmpty || isRecursively)) {
      throw new PathAlreadyExistsError('already_exists', originPage.path);
    }

    // 2. Revert target
    const parent = await this.getParentAndFillAncestorsByUser(user, newPath);
    const shouldReplace = originPage != null && originPage.isEmpty;
    let updatedPage = await Page.findByIdAndUpdate(
      page._id,
      {
        $set: {
          path: newPath,
          status: Page.STATUS_PUBLISHED,
          lastUpdateUser: user._id,
          deleteUser: null,
          deletedAt: null,
          parent: parent._id,
          descendantCount: shouldReplace ? originPage.descendantCount : 0,
        },
      },
      { new: true },
    );

    if (shouldReplace) {
      updatedPage = await Page.replaceTargetWithPage(
        originPage,
        updatedPage,
        true,
      );
    }

    await PageTagRelation.updateMany(
      { relatedPage: page._id },
      { $set: { isPageTrashed: false } },
    );

    this.pageEvent.emit('revert', page, updatedPage, user);

    if (!isRecursively) {
      await this.updateDescendantCountOfAncestors(parent._id, 1, true);

      const preNotify = preNotifyService.generatePreNotify(activity);

      this.activityEvent.emit('updated', activity, page, preNotify);
    } else {
      let pageOp: PageOperationDocument;
      try {
        pageOp = await PageOperation.create({
          actionType: PageActionType.Revert,
          actionStage: PageActionStage.Main,
          page,
          user,
          fromPath: page.path,
          toPath: newPath,
          options,
        });
      } catch (err) {
        logger.error('Failed to create PageOperation document.', err);
        throw err;
      }
      /*
       * Resumable Operation
       */
      (async () => {
        try {
          await this.revertRecursivelyMainOperation(
            page,
            user,
            options,
            pageOp._id,
            activity,
          );
          this.pageEvent.emit('syncDescendantsUpdate', updatedPage, user);
        } catch (err) {
          logger.error(
            'Error occurred while running revertRecursivelyMainOperation.',
            err,
          );

          // cleanup
          await PageOperation.deleteOne({ _id: pageOp._id });

          throw err;
        }
      })();
    }

    return updatedPage;
  }

  async revertRecursivelyMainOperation(
    page,
    user,
    options,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const descendantsSubscribedSets = new Set();
    await this.revertDeletedDescendantsWithStream(
      page,
      user,
      options,
      false,
      descendantsSubscribedSets,
    );
    const descendantsSubscribedUsers = Array.from(
      descendantsSubscribedSets,
    ) as Ref<IUser>[];

    const preNotify = preNotifyService.generatePreNotify(activity, async () => {
      return descendantsSubscribedUsers;
    });

    this.activityEvent.emit('updated', activity, page, preNotify);

    const newPath = Page.getRevertDeletedPageName(page.path);
    // normalize parent of descendant pages
    const shouldNormalize = this.shouldNormalizeParent(page);
    if (shouldNormalize) {
      try {
        await this.normalizeParentAndDescendantCountOfDescendants(
          newPath,
          user,
        );
        logger.info(
          `Successfully normalized reverted descendant pages under "${newPath}"`,
        );
      } catch (err) {
        logger.error('Failed to normalize descendants afrer revert:', err);
        throw err;
      }
    }

    // Set to Sub
    const pageOp = await PageOperation.findByIdAndUpdatePageActionStage(
      pageOpId,
      PageActionStage.Sub,
    );
    if (pageOp == null) {
      throw Error('PageOperation document not found');
    }

    /*
     * Sub Operation
     */
    await this.revertRecursivelySubOperation(newPath, pageOp._id);
  }

  async revertRecursivelySubOperation(
    newPath: string,
    pageOpId: ObjectIdLike,
  ): Promise<void> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const newTarget = await Page.findOne({ path: newPath }); // only one page will be found since duplicating to existing path is forbidden

    if (newTarget == null) {
      throw Error(
        'No reverted page found. Something might have gone wrong in revertRecursivelyMainOperation.',
      );
    }

    // update descendantCount of ancestors'
    await this.updateDescendantCountOfAncestors(
      newTarget.parent as ObjectIdLike,
      newTarget.descendantCount + 1,
      true,
    );

    await PageOperation.findByIdAndDelete(pageOpId);
  }

  private async revertDeletedPageV4(
    page,
    user,
    options = {},
    isRecursively = false,
  ) {
    const Page = mongoose.model<IPage, PageModel>('Page');

    const newPath = Page.getRevertDeletedPageName(page.path);
    const originPage = await Page.findByPath(newPath);
    if (originPage != null) {
      throw new PathAlreadyExistsError('already_exists', originPage.path);
    }

    if (isRecursively) {
      this.revertDeletedDescendantsWithStream(page, user, options);
    }

    page.status = Page.STATUS_PUBLISHED;
    page.lastUpdateUser = user;
    logger.debug('Revert deleted the page', page, newPath);
    const updatedPage = await Page.findByIdAndUpdate(
      page._id,
      {
        $set: {
          path: newPath,
          status: Page.STATUS_PUBLISHED,
          lastUpdateUser: user._id,
          deleteUser: null,
          deletedAt: null,
        },
      },
      { new: true },
    );
    await PageTagRelation.updateMany(
      { relatedPage: page._id },
      { $set: { isPageTrashed: false } },
    );

    this.pageEvent.emit('revert', page, updatedPage, user);

    return updatedPage;
  }

  private async applyScopesToDescendantsWithStream(
    parentPage,
    user,
    isV4 = false,
  ) {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const builder = new Page.PageQueryBuilder(Page.find());
    builder.addConditionToListOnlyDescendants(parentPage.path);

    if (isV4) {
      builder.addConditionAsRootOrNotOnTree();
    } else {
      builder.addConditionAsOnTree();
    }

    // add grant conditions
    await Page.addConditionToFilteringByViewerToEdit(builder, user);

    const grant = parentPage.grant;

    const userRelatedGroups =
      await this.pageGrantService.getUserRelatedGroups(user);
    const userRelatedParentGrantedGroups =
      this.pageGrantService.getUserRelatedGrantedGroupsSyncronously(
        userRelatedGroups,
        parentPage,
      );

    const childPagesReadableStream = builder.query.cursor({
      batchSize: BULK_REINDEX_SIZE,
    });
    const batchStream = createBatchStream(BULK_REINDEX_SIZE);
    const childPagesWritable = new Writable({
      objectMode: true,
      write: async (batch, encoding, callback) => {
        await this.updateChildPagesGrant(
          batch,
          grant,
          user,
          userRelatedGroups,
          userRelatedParentGrantedGroups,
        );
        callback();
      },
    });

    await pipeline(childPagesReadableStream, batchStream, childPagesWritable);
  }

  async updateChildPagesGrant(
    pages: PageDocument[],
    grant: PageGrant,
    user,
    userRelatedGroups: PopulatedGrantedGroup[],
    userRelatedParentGrantedGroups: IGrantedGroup[],
  ): Promise<void> {
    const Page = this.crowi.model('Page');
    const operations: any = [];

    pages.forEach((childPage) => {
      let newChildGrantedGroups: IGrantedGroup[] = [];
      if (grant === PageGrant.GRANT_USER_GROUP) {
        newChildGrantedGroups = this.getNewGrantedGroupsSyncronously(
          userRelatedGroups,
          userRelatedParentGrantedGroups,
          childPage,
        );
      }
      const canChangeGrant =
        this.pageGrantService.validateGrantChangeSyncronously(
          userRelatedGroups,
          childPage.grantedGroups,
          grant,
          newChildGrantedGroups,
        );
      if (canChangeGrant) {
        operations.push({
          updateOne: {
            filter: { _id: childPage._id },
            update: {
              $set: {
                grant,
                grantedUsers: grant === PageGrant.GRANT_OWNER ? [user._id] : [],
                grantedGroups: newChildGrantedGroups,
              },
            },
          },
        });
      }
    });
    await Page.bulkWrite(operations);
  }

  /**
   * Create revert stream
   */
  private async revertDeletedDescendantsWithStream(
    targetPage,
    user,
    options = {},
    shouldUseV4Process = true,
    descendantsSubscribedSets?,
  ): Promise<number> {
    if (shouldUseV4Process) {
      return this.revertDeletedDescendantsWithStreamV4(
        targetPage,
        user,
        options,
      );
    }

    const readStream = await this.generateReadStreamToOperateOnlyDescendants(
      targetPage.path,
      user,
    );
    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    const revertDeletedDescendants = this.revertDeletedDescendants.bind(this);
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await revertDeletedDescendants(batch, user);
          const subscribedUsers = await Subscription.getSubscriptions(batch);
          subscribedUsers.forEach((eachUser) => {
            descendantsSubscribedSets.add(eachUser);
          });
          logger.debug(`Reverting pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('revertPages error on add anyway: ', err);
        }

        callback();
      },
      async final(callback) {
        logger.debug(`Reverting pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);

    return count;
  }

  private async revertDeletedDescendantsWithStreamV4(
    targetPage,
    user,
    options = {},
  ) {
    const readStream = await this.generateReadStreamToOperateOnlyDescendants(
      targetPage.path,
      user,
    );
    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    const revertDeletedDescendants = this.revertDeletedDescendants.bind(this);
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await revertDeletedDescendants(batch, user);
          logger.debug(`Reverting pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('revertPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.debug(`Reverting pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);

    return count;
  }

  async handlePrivatePagesForGroupsToDelete(
    groupsToDelete: UserGroupDocument[] | ExternalUserGroupDocument[],
    action: PageActionOnGroupDelete,
    transferToUserGroup: IGrantedGroup | undefined,
    user: IUser,
  ): Promise<void> {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const pages = await Page.find({
      grantedGroups: { $elemMatch: { item: { $in: groupsToDelete } } },
    });

    switch (action) {
      case PageActionOnGroupDelete.publicize:
        await Page.removeGroupsToDeleteFromPages(pages, groupsToDelete);
        break;
      case PageActionOnGroupDelete.delete:
        return this.deleteMultipleCompletely(pages, user);
      case PageActionOnGroupDelete.transfer:
        await Page.transferPagesToGroup(pages, transferToUserGroup);
        break;
      default:
        throw new Error('Unknown action for private pages');
    }
  }

  private extractStringIds(refs: Ref<HasObjectId>[]) {
    return refs.map((ref: Ref<HasObjectId>) => {
      return typeof ref === 'string' ? ref : ref._id.toString();
    });
  }

  constructBasicPageInfo(
    page: HydratedDocument<PageDocument>,
    isGuestUser?: boolean,
  ):
    | Omit<
        IPageInfoForEmpty,
        'bookmarkCount' | 'isDeletable' | 'isAbleToDeleteCompletely'
      >
    | Omit<
        IPageInfoForEntity,
        'bookmarkCount' | 'isDeletable' | 'isAbleToDeleteCompletely'
      > {
    const isMovable = isGuestUser ? false : isMovablePage(page.path);
    const pageId = page._id.toString();

    if (page.isEmpty) {
      return {
        emptyPageId: pageId,
        isNotFound: false,
        isV5Compatible: true,
        isEmpty: true,
        isMovable,
        isRevertible: false,
      } satisfies Omit<
        IPageInfoForEmpty,
        'bookmarkCount' | 'isDeletable' | 'isAbleToDeleteCompletely'
      >;
    }

    const likers = page.liker.slice(0, 15) as Ref<IUserHasId>[];
    const seenUsers = page.seenUsers.slice(0, 15) as Ref<IUserHasId>[];

    const infoForEntity = {
      isNotFound: false,
      isV5Compatible: isTopPage(page.path) || page.parent != null,
      isEmpty: false,
      sumOfLikers: page.liker.length,
      likerIds: this.extractStringIds(likers),
      seenUserIds: this.extractStringIds(seenUsers),
      sumOfSeenUsers: page.seenUsers.length,
      isMovable,
      isRevertible: isTrashPage(page.path),
      contentAge: page.getContentAge(),
      descendantCount: page.descendantCount,
      commentCount: page.commentCount,
      // the page must have a revision if it is not empty
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      latestRevisionId: getIdStringForRef(page.revision!),
    } satisfies Omit<
      IPageInfoForEntity,
      'bookmarkCount' | 'isDeletable' | 'isAbleToDeleteCompletely'
    >;

    return infoForEntity;
  }

  async shortBodiesMapByPageIds(
    pageIds: ObjectIdLike[] = [],
    user?,
  ): Promise<Record<string, string | null>> {
    const Page = mongoose.model('Page') as unknown as PageModel;
    const MAX_LENGTH = 350;

    // aggregation options
    const userGroups =
      user != null
        ? [
            ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
            ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(
              user,
            )),
          ]
        : null;
    const viewerCondition = Page.generateGrantCondition(user, userGroups);
    const filterByIds = {
      _id: { $in: pageIds },
    };

    let pages: Array<{
      _id: string;
      revisionData?: Array<{ revision?: string }>;
    }>;
    try {
      pages = await Page.aggregate([
        // filter by pageIds
        {
          $match: filterByIds,
        },
        // filter by viewer
        {
          $match: viewerCondition,
        },
        // lookup: https://docs.mongodb.com/v4.4/reference/operator/aggregation/lookup/
        {
          $lookup: {
            from: 'revisions',
            let: { localRevision: '$revision' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$_id', '$$localRevision'],
                  },
                },
              },
              {
                $project: {
                  // What is $substrCP?
                  // see: https://stackoverflow.com/questions/43556024/mongodb-error-substrbytes-invalid-range-ending-index-is-in-the-middle-of-a-ut/43556249
                  revision: { $substrCP: ['$body', 0, MAX_LENGTH] },
                },
              },
            ],
            as: 'revisionData',
          },
        },
        // projection
        {
          $project: {
            _id: 1,
            revisionData: 1,
          },
        },
      ]).exec();
    } catch (err) {
      logger.error('Error occurred while generating shortBodiesMap');
      throw err;
    }

    const shortBodiesMap = {};
    pages.forEach((page) => {
      shortBodiesMap[page._id] = page.revisionData?.[0]?.revision;
    });

    return shortBodiesMap;
  }

  async normalizeParentByPath(path: string, user): Promise<void> {
    const Page = mongoose.model<PageDocument, PageModel>('Page');
    const { PageQueryBuilder } = Page;

    // This validation is not 100% correct since it ignores user to count
    const builder = new PageQueryBuilder(Page.find());
    builder.addConditionAsRootOrNotOnTree();
    builder.addConditionToListWithDescendants(path);
    const nEstimatedNormalizationTarget: number =
      await builder.query.exec('count');
    if (nEstimatedNormalizationTarget === 0) {
      throw Error('No page is available for conversion');
    }

    const pages = await Page.findByPathAndViewer(path, user, null, false);
    if (pages == null || !Array.isArray(pages)) {
      throw Error('Something went wrong while converting pages.');
    }

    if (pages.length === 0) {
      const isForbidden = (await Page.count({ path, isEmpty: false })) > 0;
      if (isForbidden) {
        throw new V5ConversionError(
          'It is not allowed to convert this page.',
          V5ConversionErrCode.FORBIDDEN,
        );
      }
    }
    if (pages.length > 1) {
      throw new V5ConversionError(
        `There are more than two pages at the path "${path}". Please rename or delete the page first.`,
        V5ConversionErrCode.DUPLICATE_PAGES_FOUND,
      );
    }

    const notEmptyParent =
      pages[0] == null
        ? await Page.findNotEmptyParentByPathRecursively(path)
        : null;

    const page =
      pages[0] ??
      (await this.forceCreateBySystem(path, '', {
        grant: notEmptyParent?.grant,
        grantUserIds: notEmptyParent?.grantedUsers.map((u) => getIdForRef(u)),
        grantUserGroupIds: notEmptyParent?.grantedGroups,
      }));

    const grant = page.grant;
    const grantedUserIds = page.grantedUsers.map((u) => getIdForRef(u));
    const grantedGroupIds = page.grantedGroups;

    /*
     * UserGroup & Owner validation
     */
    let isGrantNormalized = false;
    try {
      const shouldCheckDescendants = true;

      isGrantNormalized = await this.pageGrantService.isGrantNormalized(
        user,
        path,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );
    } catch (err) {
      logger.error(`Failed to validate grant of page at "${path}"`, err);
      throw err;
    }
    if (!isGrantNormalized) {
      throw new V5ConversionError(
        'This page cannot be migrated since the selected grant or grantedGroup is not assignable to this page.',
        V5ConversionErrCode.GRANT_INVALID,
      );
    }

    let pageOp: PageOperationDocument;
    try {
      pageOp = await PageOperation.create({
        actionType: PageActionType.NormalizeParent,
        actionStage: PageActionStage.Main,
        page,
        user,
        fromPath: page.path,
        toPath: page.path,
      });
    } catch (err) {
      logger.error('Failed to create PageOperation document.', err);
      throw err;
    }

    (async () => {
      try {
        await this.normalizeParentRecursivelyMainOperation(
          page,
          user,
          pageOp._id,
        );
      } catch (err) {
        logger.error(
          'Error occurred while running normalizeParentRecursivelyMainOperation.',
          err,
        );

        // cleanup
        await PageOperation.deleteOne({ _id: pageOp._id });

        throw err;
      }
    })();
  }

  async normalizeParentByPageIdsRecursively(
    pageIds: ObjectIdLike[],
    user,
  ): Promise<void> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const pages = await Page.findByIdsAndViewer(pageIds, user, null);

    if (pages == null || pages.length === 0) {
      throw Error('pageIds is null or 0 length.');
    }

    if (pages.length > LIMIT_FOR_MULTIPLE_PAGE_OP) {
      throw Error(
        `The maximum number of pageIds allowed is ${LIMIT_FOR_MULTIPLE_PAGE_OP}.`,
      );
    }

    await this.normalizeParentRecursivelyByPages(pages, user);

    return;
  }

  async normalizeParentByPageIds(pageIds: ObjectIdLike[], user): Promise<void> {
    const Page = (await mongoose.model('Page')) as unknown as PageModel;

    const socket = this.crowi.socketIoService.getDefaultSocket();

    for await (const pageId of pageIds) {
      const page = await Page.findById(pageId);
      if (page == null) {
        continue;
      }

      const errorData: PageMigrationErrorData = { paths: [page.path] };

      try {
        const canOperate = await this.crowi.pageOperationService.canOperate(
          false,
          page.path,
          page.path,
        );
        if (!canOperate) {
          throw Error(
            `Cannot operate normalizeParent to path "${page.path}" right now.`,
          );
        }

        const normalizedPage = await this.normalizeParentByPage(page, user);

        if (normalizedPage == null) {
          socket.emit(SocketEventName.PageMigrationError, errorData);
          logger.error(
            `Failed to update descendantCount of page of id: "${pageId}"`,
          );
        }
      } catch (err) {
        socket.emit(SocketEventName.PageMigrationError, errorData);
        logger.error('Something went wrong while normalizing parent.', err);
      }
    }
    socket.emit(SocketEventName.PageMigrationSuccess);
  }

  private async normalizeParentByPage(page, user) {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const {
      path,
      grant,
      grantedUsers: grantedUserIds,
      grantedGroups: grantedGroupIds,
    } = page;

    // check if any page exists at target path already
    const existingPage = await Page.findOne({ path, parent: { $ne: null } });
    if (existingPage != null && !existingPage.isEmpty) {
      throw Error('Page already exists. Please rename the page to continue.');
    }

    /*
     * UserGroup & Owner validation
     */
    if (grant !== Page.GRANT_RESTRICTED) {
      let isGrantNormalized = false;
      try {
        const shouldCheckDescendants = true;

        isGrantNormalized = await this.pageGrantService.isGrantNormalized(
          user,
          path,
          grant,
          grantedUserIds,
          grantedGroupIds,
          shouldCheckDescendants,
        );
      } catch (err) {
        logger.error(`Failed to validate grant of page at "${path}"`, err);
        throw err;
      }
      if (!isGrantNormalized) {
        throw Error(
          'This page cannot be migrated since the selected grant or grantedGroup is not assignable to this page.',
        );
      }
    } else {
      throw Error('Restricted pages can not be migrated');
    }

    let normalizedPage: PageDocument | null;

    // replace if empty page exists
    if (existingPage != null && existingPage.isEmpty) {
      // Inherit descendantCount from the empty page
      const updatedPage = await Page.findOneAndUpdate(
        { _id: page._id },
        { descendantCount: existingPage.descendantCount },
        { new: true },
      );
      await Page.replaceTargetWithPage(existingPage, updatedPage, true);
      normalizedPage = await Page.findById(page._id);
    } else {
      const parent = await this.getParentAndFillAncestorsByUser(
        user,
        page.path,
      );
      normalizedPage = await Page.findOneAndUpdate(
        { _id: page._id },
        { parent: parent._id },
        { new: true },
      );
    }

    // Update descendantCount
    const inc = 1;
    if (normalizedPage != null && normalizedPage.parent != null) {
      await this.updateDescendantCountOfAncestors(
        getIdForRef(normalizedPage.parent),
        inc,
        true,
      );
    }

    return normalizedPage;
  }

  async normalizeParentRecursivelyByPages(pages, user): Promise<void> {
    /*
     * Main Operation
     */
    const socket = this.crowi.socketIoService.getDefaultSocket();

    const pagesToNormalize = omitDuplicateAreaPageFromPages(pages);

    let normalizablePages: PageDocument[];
    let nonNormalizablePages: PageDocument[];
    try {
      [normalizablePages, nonNormalizablePages] =
        await this.pageGrantService.separateNormalizableAndNotNormalizablePages(
          user,
          pagesToNormalize,
        );
    } catch (err) {
      socket.emit(SocketEventName.PageMigrationError);
      throw err;
    }

    if (normalizablePages.length === 0) {
      socket.emit(SocketEventName.PageMigrationError);
      return;
    }

    if (nonNormalizablePages.length !== 0) {
      const nonNormalizablePagePaths: string[] = nonNormalizablePages.map(
        (p) => p.path,
      );
      socket.emit(SocketEventName.PageMigrationError, {
        paths: nonNormalizablePagePaths,
      });
      logger.debug(
        'Some pages could not be converted.',
        nonNormalizablePagePaths,
      );
    }

    /*
     * Main Operation (s)
     */
    const errorPagePaths: string[] = [];
    for await (const page of normalizablePages) {
      const canOperate = await this.crowi.pageOperationService.canOperate(
        true,
        page.path,
        page.path,
      );
      if (!canOperate) {
        errorPagePaths.push(page.path);
        throw Error(
          `Cannot operate normalizeParentRecursiively to path "${page.path}" right now.`,
        );
      }

      const Page = mongoose.model('Page') as unknown as PageModel;
      const { PageQueryBuilder } = Page;
      const builder = new PageQueryBuilder(Page.findOne());
      builder.addConditionAsOnTree();
      builder.addConditionToListByPathsArray([page.path]);
      const existingPage = await builder.query.exec();

      if (existingPage?.parent != null) {
        errorPagePaths.push(page.path);
        throw Error('This page has already converted.');
      }

      let pageOp: PageOperationDocument;
      try {
        pageOp = await PageOperation.create({
          actionType: PageActionType.NormalizeParent,
          actionStage: PageActionStage.Main,
          page,
          user,
          fromPath: page.path,
          toPath: page.path,
        });
      } catch (err) {
        errorPagePaths.push(page.path);
        logger.error('Failed to create PageOperation document.', err);
        throw err;
      }

      try {
        await this.normalizeParentRecursivelyMainOperation(
          page,
          user,
          pageOp._id,
        );
      } catch (err) {
        errorPagePaths.push(page.path);
        logger.error(
          'Failed to run normalizeParentRecursivelyMainOperation.',
          err,
        );

        // cleanup
        await PageOperation.deleteOne({ _id: pageOp._id });

        throw err;
      }
    }
    if (errorPagePaths.length === 0) {
      socket.emit(SocketEventName.PageMigrationSuccess);
    } else {
      socket.emit(SocketEventName.PageMigrationError, {
        paths: errorPagePaths,
      });
    }
  }

  async normalizeParentRecursivelyMainOperation(
    page,
    user,
    pageOpId: ObjectIdLike,
  ): Promise<number> {
    // Save prevDescendantCount for sub-operation
    const Page = mongoose.model('Page') as unknown as PageModel;
    const { PageQueryBuilder } = Page;
    const builder = new PageQueryBuilder(Page.findOne(), true);
    builder.addConditionAsOnTree();
    builder.addConditionToListByPathsArray([page.path]);
    const exPage = await builder.query.exec();
    const options = { prevDescendantCount: exPage?.descendantCount ?? 0 };

    let count: number;
    try {
      count = await this.normalizeParentRecursively([page.path], user);
    } catch (err) {
      logger.error('V5 initial miration failed.', err);
      // socket.emit('normalizeParentRecursivelyByPageIds', { error: err.message }); TODO: use socket to tell user

      throw err;
    }

    // Set to Sub
    const pageOp = await PageOperation.findByIdAndUpdatePageActionStage(
      pageOpId,
      PageActionStage.Sub,
    );
    if (pageOp == null) {
      throw Error('PageOperation document not found');
    }

    await this.normalizeParentRecursivelySubOperation(
      page,
      user,
      pageOp._id,
      options,
    );

    return count;
  }

  async normalizeParentRecursivelySubOperation(
    page,
    user,
    pageOpId: ObjectIdLike,
    options: { prevDescendantCount: number },
  ): Promise<void> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    try {
      // update descendantCount of self and descendant pages first
      await this.updateDescendantCountOfSelfAndDescendants(page.path);

      // find pages again to get updated descendantCount
      // then calculate inc
      const pageAfterUpdatingDescendantCount = await Page.findByIdAndViewer(
        page._id,
        user,
      );
      if (pageAfterUpdatingDescendantCount == null) {
        throw Error('Page not found after updating descendantCount');
      }

      const { prevDescendantCount } = options;
      const newDescendantCount =
        pageAfterUpdatingDescendantCount.descendantCount;
      let inc = newDescendantCount - prevDescendantCount;
      const isAlreadyConverted = page.parent != null;
      if (!isAlreadyConverted) {
        inc += 1;
      }
      await this.updateDescendantCountOfAncestors(page._id, inc, false);
    } catch (err) {
      logger.error(
        'Failed to update descendantCount after normalizing parent:',
        err,
      );
      throw Error(
        `Failed to update descendantCount after normalizing parent: ${err}`,
      );
    }

    await PageOperation.findByIdAndDelete(pageOpId);
  }

  async _isPagePathIndexUnique() {
    const Page = this.crowi.model('Page');
    const now = new Date().toString();
    const path = `growi_check_is_path_index_unique_${now}`;

    let isUnique = false;

    try {
      await Page.insertMany([{ path }, { path }]);
    } catch (err) {
      if (err?.code === 11000) {
        // Error code 11000 indicates the index is unique
        isUnique = true;
        logger.info('Page path index is unique.');
      } else {
        throw err;
      }
    } finally {
      await Page.deleteMany({
        path: { $regex: /growi_check_is_path_index_unique/g },
      });
    }

    return isUnique;
  }

  async normalizeAllPublicPages(): Promise<void> {
    let isUnique: boolean;
    try {
      isUnique = await this._isPagePathIndexUnique();
    } catch (err) {
      logger.error('Failed to check path index status', err);
      throw err;
    }

    // drop unique index first
    if (isUnique) {
      try {
        await this._v5NormalizeIndex();
      } catch (err) {
        logger.error('V5 index normalization failed.', err);
        throw err;
      }
    }

    // then migrate
    try {
      await this.normalizeParentRecursively(['/'], null, false, true);
    } catch (err) {
      logger.error('V5 initial miration failed.', err);

      throw err;
    }

    // update descendantCount of all public pages
    try {
      await this.updateDescendantCountOfSelfAndDescendants('/');
      logger.info('Successfully updated all descendantCount of public pages.');
    } catch (err) {
      logger.error('Failed updating descendantCount of public pages.', err);
      throw err;
    }

    await this._setIsV5CompatibleTrue();
  }

  private async _setIsV5CompatibleTrue() {
    try {
      await configManager.updateConfig('app:isV5Compatible', true);
      logger.info('Successfully migrated all public pages.');
    } catch (err) {
      logger.warn('Failed to update app:isV5Compatible to true.');
      throw err;
    }
  }

  private async normalizeParentAndDescendantCountOfDescendants(
    path: string,
    user,
    isDuplicateOperation = false,
  ): Promise<void> {
    await this.normalizeParentRecursively([path], user, isDuplicateOperation);

    // update descendantCount of descendant pages
    await this.updateDescendantCountOfSelfAndDescendants(path);
  }

  /**
   * Normalize parent attribute by passing paths and user.
   * @param paths Pages under this paths value will be updated.
   * @param user To be used to filter pages to update. If null, only public pages will be updated.
   * @returns Promise<void>
   */
  async normalizeParentRecursively(
    paths: string[],
    user: any | null,
    isDuplicateOperation = false,
    shouldEmitProgress = false,
  ): Promise<number> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const ancestorPaths = paths.flatMap((p) => collectAncestorPaths(p, []));
    // targets' descendants
    const pathAndRegExpsToNormalize: (RegExp | string)[] = paths.map(
      (p) => new RegExp(`^${escapeStringRegexp(addTrailingSlash(p))}`, 'i'),
    );
    // include targets' path
    pathAndRegExpsToNormalize.push(...paths);

    // determine UserGroup condition
    const userGroups =
      user != null
        ? [
            ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
            ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(
              user,
            )),
          ]
        : null;

    const grantFiltersByUser: { $or: any[] } | null = !isDuplicateOperation
      ? Page.generateGrantCondition(user, userGroups)
      : null;

    return this._normalizeParentRecursively(
      pathAndRegExpsToNormalize,
      ancestorPaths,
      user,
      grantFiltersByUser,
      shouldEmitProgress,
    );
  }

  private buildFilterForNormalizeParentRecursively(
    pathOrRegExps: (RegExp | string)[],
    publicPathsToNormalize: string[],
    grantFiltersByUser?: { $or: any[] } | null,
  ) {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const andFilter: any = {
      $and: [
        {
          parent: null,
          status: Page.STATUS_PUBLISHED,
          path: { $ne: '/' },
        },
      ],
    };
    const orFilter: any = { $or: [] };
    // specified pathOrRegExps
    if (pathOrRegExps.length > 0) {
      orFilter.$or.push({
        path: { $in: pathOrRegExps },
      });
    }
    // not specified but ancestors of specified pathOrRegExps
    if (publicPathsToNormalize.length > 0) {
      orFilter.$or.push({
        path: { $in: publicPathsToNormalize },
        grant: Page.GRANT_PUBLIC, // use only public pages to complete the tree
      });
    }

    // Merge filters
    const mergedFilter = {
      $and: [
        {
          $and:
            grantFiltersByUser != null
              ? [grantFiltersByUser, ...andFilter.$and]
              : [...andFilter.$and],
        },
        { $or: orFilter.$or },
      ],
    };

    return mergedFilter;
  }

  private async _normalizeParentRecursively(
    pathOrRegExps: (RegExp | string)[],
    publicPathsToNormalize: string[],
    user,
    grantFiltersByUser: { $or: any[] } | null,
    shouldEmitProgress = false,
    count = 0,
    skiped = 0,
    isFirst = true,
  ): Promise<number> {
    const BATCH_SIZE = 100;
    const PAGES_LIMIT = 1000;

    const socket = shouldEmitProgress
      ? this.crowi.socketIoService.getAdminSocket()
      : null;

    const Page = mongoose.model('Page') as unknown as PageModel;
    const { PageQueryBuilder } = Page;

    // Build filter
    const matchFilter = this.buildFilterForNormalizeParentRecursively(
      pathOrRegExps,
      publicPathsToNormalize,
      grantFiltersByUser,
    );

    let baseAggregation = Page.aggregate([
      { $match: matchFilter },
      {
        $project: {
          // minimize data to fetch
          _id: 1,
          path: 1,
        },
      },
    ]);

    // Limit pages to get
    const total = await Page.countDocuments(matchFilter);
    if (isFirst) {
      socket?.emit(SocketEventName.PMStarted, { total });
    }
    if (total > PAGES_LIMIT) {
      baseAggregation = baseAggregation.limit(Math.floor(total * 0.3));
    }

    const pagesStream = await baseAggregation.cursor({ batchSize: BATCH_SIZE });
    const batchStream = createBatchStream(BATCH_SIZE);

    let shouldContinue = true;
    let nextCount = count;
    let nextSkiped = skiped;

    // eslint-disable-next-line max-len
    const buildPipelineToCreateEmptyPagesByUser =
      this.buildPipelineToCreateEmptyPagesByUser.bind(this);

    const migratePagesStream = new Writable({
      objectMode: true,
      async write(pages, encoding, callback) {
        const parentPaths = Array.from(
          new Set<string>(pages.map((p) => pathlib.dirname(p.path))),
        );

        // 1. Remove unnecessary empty pages & reset parent for pages which had had those empty pages
        const pageIdsToNotDelete = pages.map((p) => p._id);
        const emptyPagePathsToDelete = pages.map((p) => p.path);

        const builder1 = new PageQueryBuilder(
          Page.find({ isEmpty: true }, { _id: 1 }),
          true,
        );
        builder1.addConditionToListByPathsArray(emptyPagePathsToDelete);
        builder1.addConditionToExcludeByPageIdsArray(pageIdsToNotDelete);

        const emptyPagesToDelete = await builder1.query.lean().exec();
        const resetParentOperations = emptyPagesToDelete.map((p) => {
          return {
            updateOne: {
              filter: {
                parent: p._id,
              },
              update: {
                parent: null,
              },
            },
          };
        });

        await Page.bulkWrite(resetParentOperations);
        await Page.removeEmptyPages(pageIdsToNotDelete, emptyPagePathsToDelete);

        // 2. Create lacking parents as empty pages
        const orFilters = [
          { path: '/' },
          {
            path: { $in: publicPathsToNormalize },
            grant: Page.GRANT_PUBLIC,
            status: Page.STATUS_PUBLISHED,
          },
          {
            path: { $in: publicPathsToNormalize },
            parent: { $ne: null },
            status: Page.STATUS_PUBLISHED,
          },
          {
            path: { $nin: publicPathsToNormalize },
            status: Page.STATUS_PUBLISHED,
          },
        ];
        const filterForApplicableAncestors = { $or: orFilters };
        const aggregationPipeline = await buildPipelineToCreateEmptyPagesByUser(
          user,
          parentPaths,
          false,
          filterForApplicableAncestors,
        );
        await Page.createEmptyPagesByPaths(parentPaths, aggregationPipeline);

        // 3. Find parents
        const builder2 = new PageQueryBuilder(Page.find(), true);
        if (grantFiltersByUser != null) {
          builder2.query = builder2.query.and(grantFiltersByUser);
        }
        const parents = await builder2
          .addConditionToListByPathsArray(parentPaths)
          .addConditionToFilterByApplicableAncestors(publicPathsToNormalize)
          .query.lean()
          .exec();

        // Normalize all siblings for each page
        const updateManyOperations = parents.map((parent) => {
          const parentId = parent._id;

          // Build filter
          const parentPathEscaped = escapeStringRegexp(
            parent.path === '/' ? '' : parent.path,
          ); // adjust the path for RegExp
          const filter: any = {
            $and: [
              {
                path: {
                  $regex: new RegExp(
                    `^${parentPathEscaped}(\\/[^/]+)\\/?$`,
                    'i',
                  ),
                }, // see: regexr.com/6889f (e.g. /parent/any_child or /any_level1)
              },
              {
                path: { $in: pathOrRegExps.concat(publicPathsToNormalize) },
              },
              filterForApplicableAncestors,
            ],
          };
          if (grantFiltersByUser != null) {
            filter.$and.push(grantFiltersByUser);
          }

          return {
            updateMany: {
              filter,
              update: {
                parent: parentId,
              },
            },
          };
        });
        try {
          const res = await Page.bulkWrite(updateManyOperations);

          nextCount += res.result.nModified;
          nextSkiped += res.result.writeErrors.length;
          logger.info(
            `Page migration processing: (migratedPages=${res.result.nModified})`,
          );

          socket?.emit(SocketEventName.PMMigrating, { count: nextCount });
          socket?.emit(SocketEventName.PMErrorCount, { skip: nextSkiped });

          // Throw if any error is found
          if (res.result.writeErrors.length > 0) {
            logger.error(
              'Failed to migrate some pages',
              res.result.writeErrors,
            );
            socket?.emit(SocketEventName.PMEnded, { isSucceeded: false });
            throw Error('Failed to migrate some pages');
          }

          // Finish migration if no modification occurred
          if (res.result.nModified === 0 && res.result.nMatched === 0) {
            shouldContinue = false;
            logger.error(
              'Migration is unable to continue',
              'parentPaths:',
              parentPaths,
              'bulkWriteResult:',
              res,
            );
            socket?.emit(SocketEventName.PMEnded, { isSucceeded: false });
          }
        } catch (err) {
          logger.error('Failed to update page.parent.', err);
          throw err;
        }

        callback();
      },
      final(callback) {
        callback();
      },
    });

    await pipeline(pagesStream, batchStream, migratePagesStream);

    if ((await Page.exists(matchFilter)) && shouldContinue) {
      return this._normalizeParentRecursively(
        pathOrRegExps,
        publicPathsToNormalize,
        user,
        grantFiltersByUser,
        shouldEmitProgress,
        nextCount,
        nextSkiped,
        false,
      );
    }

    // End
    socket?.emit(SocketEventName.PMEnded, { isSucceeded: true });

    return nextCount;
  }

  private async _v5NormalizeIndex() {
    const collection = mongoose.connection.collection('pages');

    try {
      // drop pages.path_1 indexes
      await collection.dropIndex('path_1');
      logger.info('Succeeded to drop unique indexes from pages.path.');
    } catch (err) {
      logger.warn('Failed to drop unique indexes from pages.path.', err);
      throw err;
    }

    try {
      // create indexes without
      await collection.createIndex({ path: 1 }, { unique: false });
      logger.info('Succeeded to create non-unique indexes on pages.path.');
    } catch (err) {
      logger.warn('Failed to create non-unique indexes on pages.path.', err);
      throw err;
    }
  }

  async countPagesCanNormalizeParentByUser(user): Promise<number> {
    if (user == null) {
      throw Error('user is required');
    }

    const Page = mongoose.model('Page') as unknown as PageModel;
    const { PageQueryBuilder } = Page;

    const builder = new PageQueryBuilder(Page.count(), false);
    await builder.addConditionAsMigratablePages(user);

    const nMigratablePages = await builder.query.exec();

    return nMigratablePages;
  }

  /**
   * update descendantCount of the following pages
   * - page that has the same path as the provided path
   * - pages that are descendants of the above page
   */
  async updateDescendantCountOfSelfAndDescendants(path: string): Promise<void> {
    const BATCH_SIZE = 200;
    const Page = mongoose.model<IPage, PageModel>('Page');
    const { PageQueryBuilder } = Page;

    const builder = new PageQueryBuilder(Page.find(), true);
    builder.addConditionAsOnTree();
    builder.addConditionToListWithDescendants(path);
    builder.addConditionToSortPagesByDescPath();

    const aggregatedPages = await builder.query
      .lean()
      .cursor({ batchSize: BATCH_SIZE });
    await this.recountAndUpdateDescendantCountOfPages(
      aggregatedPages,
      BATCH_SIZE,
    );
  }

  /**
   * update descendantCount of the pages sequentially from longer path to shorter path
   */
  async updateDescendantCountOfPagesWithPaths(paths: string[]): Promise<void> {
    const BATCH_SIZE = 200;
    const Page = mongoose.model<IPage, PageModel>('Page');
    const { PageQueryBuilder } = Page;

    const builder = new PageQueryBuilder(Page.find(), true);
    builder.addConditionToListByPathsArray(paths); // find by paths
    builder.addConditionToSortPagesByDescPath(); // sort in DESC

    const aggregatedPages = await builder.query
      .lean()
      .cursor({ batchSize: BATCH_SIZE });
    await this.recountAndUpdateDescendantCountOfPages(
      aggregatedPages,
      BATCH_SIZE,
    );
  }

  /**
   * Recount descendantCount of pages one by one
   */
  async recountAndUpdateDescendantCountOfPages(
    pageCursor: Cursor<any>,
    batchSize: number,
  ): Promise<void> {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const batchStream = createBatchStream(batchSize);
    const recountWriteStream = new Writable({
      objectMode: true,
      async write(pageDocuments, encoding, callback) {
        for await (const document of pageDocuments) {
          const descendantCount = await Page.recountDescendantCount(
            document._id,
          );
          await Page.findByIdAndUpdate(document._id, { descendantCount });
        }
        callback();
      },
      final(callback) {
        callback();
      },
    });

    await pipeline(pageCursor, batchStream, recountWriteStream);
  }

  // update descendantCount of all pages that are ancestors of a provided pageId by count
  async updateDescendantCountOfAncestors(
    pageId: ObjectIdLike,
    inc: number,
    shouldIncludeTarget: boolean,
  ): Promise<void> {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const ancestors = await Page.findAncestorsUsingParentRecursively(
      pageId,
      shouldIncludeTarget,
    );
    const ancestorPageIds = ancestors.map((p) => p._id);

    await Page.incrementDescendantCountOfPageIds(ancestorPageIds, inc);

    const updateDescCountData: UpdateDescCountRawData = Object.fromEntries(
      ancestors.map((p) => [p._id.toString(), p.descendantCount + inc]),
    );
    this.emitUpdateDescCount(updateDescCountData);
  }

  private emitUpdateDescCount(data: UpdateDescCountRawData): void {
    const socket = this.crowi.socketIoService.getDefaultSocket();

    socket.emit(SocketEventName.UpdateDescCount, data);
  }

  /**
   * Build the base aggregation pipeline for fillAncestors--- methods
   * @param onlyMigratedAsExistingPages Determine whether to include non-migrated pages as existing pages. If a page exists,
   * an empty page will not be created at that page's path.
   */
  private buildBasePipelineToCreateEmptyPages(
    paths: string[],
    onlyMigratedAsExistingPages = true,
    andFilter?,
  ): any[] {
    const aggregationPipeline: any[] = [];

    const Page = mongoose.model('Page') as unknown as PageModel;

    // -- Filter by paths
    aggregationPipeline.push({ $match: { path: { $in: paths } } });
    // -- Normalized condition
    if (onlyMigratedAsExistingPages) {
      aggregationPipeline.push({
        $match: {
          $or: [
            { grant: Page.GRANT_PUBLIC },
            { parent: { $ne: null } },
            { path: '/' },
          ],
        },
      });
    }
    // -- Add custom pipeline
    if (andFilter != null) {
      aggregationPipeline.push({ $match: andFilter });
    }

    return aggregationPipeline;
  }

  private async buildPipelineToCreateEmptyPagesByUser(
    user,
    paths: string[],
    onlyMigratedAsExistingPages = true,
    andFilter?,
  ): Promise<any[]> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const pipeline = this.buildBasePipelineToCreateEmptyPages(
      paths,
      onlyMigratedAsExistingPages,
      andFilter,
    );
    const userGroups =
      user != null
        ? [
            ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
            ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(
              user,
            )),
          ]
        : null;
    const grantCondition = Page.generateGrantCondition(user, userGroups);
    pipeline.push({ $match: grantCondition });

    return pipeline;
  }

  private buildPipelineToCreateEmptyPagesBySystem(paths: string[]): any[] {
    return this.buildBasePipelineToCreateEmptyPages(paths);
  }

  private async connectPageTree(path: string): Promise<void> {
    const Page = mongoose.model('Page') as unknown as PageModel;
    const { PageQueryBuilder } = Page;

    const ancestorPaths = collectAncestorPaths(path);

    // Find ancestors
    const builder = new PageQueryBuilder(Page.find(), true);
    builder.addConditionToFilterByApplicableAncestors(ancestorPaths); // avoid including not normalized pages
    const ancestors = await builder
      .addConditionToListByPathsArray(ancestorPaths)
      .addConditionToSortPagesByDescPath()
      .query.exec();

    // Update parent attrs
    const ancestorsMap = new Map(); // Map<path, page>
    for (const ancestor of ancestors) {
      if (!ancestorsMap.has(ancestor.path)) {
        ancestorsMap.set(ancestor.path, ancestor); // the earlier element should be the true ancestor
      }
    }

    const nonRootAncestors = ancestors.filter((page) => !isTopPage(page.path));
    const operations = nonRootAncestors.map((page) => {
      const parentPath = pathlib.dirname(page.path);
      return {
        updateOne: {
          filter: {
            _id: page._id,
          },
          update: {
            parent: ancestorsMap.get(parentPath)._id,
          },
        },
      };
    });
    await Page.bulkWrite(operations);
  }

  /**
   * Find parent or create parent if not exists.
   * It also updates parent of ancestors
   * @param path string
   * @returns Promise<PageDocument>
   */
  async getParentAndFillAncestorsByUser(
    user,
    path: string,
  ): Promise<HydratedDocument<PageDocument>> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    // Find parent
    const parent = await Page.findParentByPath(path);
    if (parent != null) {
      return parent;
    }

    const ancestorPaths = collectAncestorPaths(path);

    // Fill ancestors
    const aggregationPipeline: any[] =
      await this.buildPipelineToCreateEmptyPagesByUser(user, ancestorPaths);

    await Page.createEmptyPagesByPaths(ancestorPaths, aggregationPipeline);

    // Connect ancestors
    await this.connectPageTree(path);

    // Return the created parent
    const createdParent = await Page.findParentByPath(path);
    if (createdParent == null) {
      throw Error(
        'Failed to find the created parent by getParentAndFillAncestorsByUser',
      );
    }
    return createdParent;
  }

  async getParentAndFillAncestorsBySystem(
    path: string,
  ): Promise<HydratedDocument<PageDocument>> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    // Find parent
    const parent = await Page.findParentByPath(path);
    if (parent != null) {
      return parent;
    }

    // Fill ancestors
    const ancestorPaths = collectAncestorPaths(path);
    const aggregationPipeline: any[] =
      this.buildPipelineToCreateEmptyPagesBySystem(ancestorPaths);

    await Page.createEmptyPagesByPaths(ancestorPaths, aggregationPipeline);

    // Connect ancestors
    await this.connectPageTree(path);

    // Return the created parent
    const createdParent = await Page.findParentByPath(path);
    if (createdParent == null) {
      throw Error(
        'Failed to find the created parent by getParentAndFillAncestorsByUser',
      );
    }

    return createdParent;
  }

  // --------- Create ---------

  private async preparePageDocumentToCreate(
    path: string,
    shouldNew: boolean,
  ): Promise<HydratedDocument<PageDocument>> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    const emptyPage = await Page.findOne({ path, isEmpty: true });

    // Use empty page if exists, if not, create a new page
    let page: HydratedDocument<PageDocument>;
    if (shouldNew) {
      page = new Page();
    } else if (emptyPage != null) {
      page = emptyPage;
      const descendantCount = await Page.recountDescendantCount(page._id);

      page.descendantCount = descendantCount;
      page.isEmpty = false;
    } else {
      page = new Page();
    }

    return page;
  }

  private setFieldExceptForGrantRevisionParent(
    pageDocument: PageDocument,
    path: string,
    user?,
  ): void {
    const Page = mongoose.model('Page') as unknown as PageModel;

    pageDocument.path = path;
    pageDocument.creator = user;
    pageDocument.lastUpdateUser = user;
    pageDocument.status = Page.STATUS_PUBLISHED;
  }

  private async validateAppliedScope(
    user,
    grant,
    grantUserGroupIds: IGrantedGroup[],
  ) {
    if (grant === PageGrant.GRANT_USER_GROUP && grantUserGroupIds == null) {
      throw new Error('grantUserGroupIds is not specified');
    }

    if (grant === PageGrant.GRANT_USER_GROUP) {
      const {
        grantedUserGroups: grantedUserGroupIds,
        grantedExternalUserGroups: grantedExternalUserGroupIds,
      } = divideByType(grantUserGroupIds);
      const count =
        (await UserGroupRelation.countByGroupIdsAndUser(
          grantedUserGroupIds,
          user,
        )) +
        (await ExternalUserGroupRelation.countByGroupIdsAndUser(
          grantedExternalUserGroupIds,
          user,
        ));

      if (count === 0) {
        throw new Error('no relations were exist for group and user.');
      }
    }
  }

  private async canProcessCreate(
    path: string,
    grantData: {
      grant?: PageGrant;
      grantUserIds?: ObjectIdLike[];
      grantUserGroupIds?: IGrantedGroup[];
    },
    shouldValidateGrant: boolean,
    user?,
    options?: IOptionsForCreate,
  ): Promise<boolean> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    // Operatability validation
    const canOperate = await this.crowi.pageOperationService.canOperate(
      false,
      null,
      path,
    );
    if (!canOperate) {
      logger.error(`Cannot operate create to path "${path}" right now.`);
      return false;
    }

    // Existance validation
    const isExist = (await Page.count({ path, isEmpty: false })) > 0; // not validate empty page
    if (isExist) {
      logger.error('Cannot create new page to existed path');
      return false;
    }

    // UserGroup & Owner validation
    const { grant, grantUserIds, grantUserGroupIds } = grantData;
    if (shouldValidateGrant) {
      if (user == null) {
        throw Error('user is required to validate grant');
      }

      let isGrantNormalized = false;
      try {
        // It must check descendants as well if emptyTarget is not null
        const isEmptyPageAlreadyExist =
          (await Page.count({ path, isEmpty: true })) > 0;
        const shouldCheckDescendants =
          isEmptyPageAlreadyExist && !options?.overwriteScopesOfDescendants;

        isGrantNormalized = await this.pageGrantService.isGrantNormalized(
          user,
          path,
          grant,
          grantUserIds,
          grantUserGroupIds,
          shouldCheckDescendants,
        );
      } catch (err) {
        logger.error(
          `Failed to validate grant of page at "${path}" of grant ${grant}:`,
          err,
        );
        throw err;
      }
      if (!isGrantNormalized) {
        throw Error(
          'The selected grant or grantedGroup is not assignable to this page.',
        );
      }

      if (options?.overwriteScopesOfDescendants) {
        const updateGrantInfo =
          await this.pageGrantService.generateUpdateGrantInfoToOverwriteDescendants(
            user,
            grant,
            options.grantUserGroupIds,
          );
        const canOverwriteDescendants =
          await this.pageGrantService.canOverwriteDescendants(
            path,
            user,
            updateGrantInfo,
          );

        if (!canOverwriteDescendants) {
          throw Error('Cannot overwrite scopes of descendants.');
        }
      }
    }

    return true;
  }

  /**
   * Create a page
   * Set options.isSynchronously to true to await all process when you want to run this method multiple times at short intervals.
   */
  async create(
    _path: string,
    body: string,
    user: HasObjectId,
    options: IOptionsForCreate = {},
  ): Promise<HydratedDocument<PageDocument>> {
    // Switch method
    const isV5Compatible = configManager.getConfig('app:isV5Compatible');
    if (!isV5Compatible) {
      return this.createV4(_path, body, user, options);
    }

    // Values
    const path: string = generalXssFilter.process(_path); // sanitize path

    // Retrieve closest ancestor document
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );
    const closestAncestor = await Page.findNonEmptyClosestAncestor(path);

    // Determine grantData
    const grant =
      options.grant ?? closestAncestor?.grant ?? PageGrant.GRANT_PUBLIC;
    const grantUserIds =
      grant === PageGrant.GRANT_OWNER ? [user._id] : undefined;
    const getGrantedGroupsFromClosestAncestor = async () => {
      if (closestAncestor == null) return undefined;
      if (options.onlyInheritUserRelatedGrantedGroups) {
        return this.pageGrantService.getUserRelatedGrantedGroups(
          closestAncestor,
          user,
        );
      }
      return closestAncestor.grantedGroups;
    };
    const grantUserGroupIds =
      options.grantUserGroupIds ??
      (await getGrantedGroupsFromClosestAncestor());
    const grantData = {
      grant,
      grantUserIds,
      grantUserGroupIds,
    };

    const isGrantRestricted = grant === PageGrant.GRANT_RESTRICTED;

    // Validate
    const shouldValidateGrant = !isGrantRestricted;
    const canProcessCreate = await this.canProcessCreate(
      path,
      grantData,
      shouldValidateGrant,
      user,
      options,
    );
    if (!canProcessCreate) {
      throw Error('Cannot process create');
    }

    // Prepare a page document
    const shouldNew = isGrantRestricted;
    const page = await this.preparePageDocumentToCreate(path, shouldNew);

    // Set field
    this.setFieldExceptForGrantRevisionParent(page, path, user);

    // Apply scope
    page.applyScope(user, grant, grantUserGroupIds);

    // Set parent
    if (isTopPage(path) || isGrantRestricted) {
      // set parent to null when GRANT_RESTRICTED
      page.parent = null;
    } else {
      const parent = await this.getParentAndFillAncestorsByUser(user, path);
      page.parent = parent._id;
    }

    // Make WIP
    if (options.wip) {
      const hasChildren = await Page.exists({ parent: page._id });
      page.makeWip(hasChildren != null); // disableTtl = hasChildren != null
    }

    // Save
    let savedPage = await page.save();

    // Create revision
    const newRevision = Revision.prepareRevision(
      savedPage,
      body,
      null,
      user,
      options.origin,
    );
    savedPage = await pushRevision(savedPage, newRevision, user);
    await savedPage.populateDataToShowRevision();

    // Emit create event
    this.pageEvent.emit('create', savedPage, user);

    // Directly run sub operation for now since it might be complex to handle main operation for creating pages -- Taichi Masuyama 2022.11.08
    let pageOp: PageOperationDocument;
    try {
      pageOp = await PageOperation.create({
        actionType: PageActionType.Create,
        actionStage: PageActionStage.Sub,
        page: savedPage,
        user,
        fromPath: path,
        options,
      });
    } catch (err) {
      logger.error('Failed to create PageOperation document.', err);
      throw err;
    }

    this.createSubOperation(savedPage, user, options, pageOp._id);

    return savedPage;
  }

  /**
   * Used to run sub operation in create method
   */
  async createSubOperation(
    page,
    user,
    options: IOptionsForCreate,
    pageOpId: ObjectIdLike,
  ): Promise<void> {
    await this.disableAncestorPagesTtl(page.path);

    // Update descendantCount
    await this.updateDescendantCountOfAncestors(page._id, 1, false);

    // Delete PageRedirect if exists
    try {
      await PageRedirect.deleteOne({ fromPath: page.path });
      logger.warn(
        `Deleted page redirect after creating a new page at path "${page.path}".`,
      );
    } catch (err) {
      // no throw
      logger.error('Failed to delete PageRedirect');
    }

    // update scopes for descendants
    if (options.overwriteScopesOfDescendants) {
      await this.applyScopesToDescendantsWithStream(page, user);
    }

    await PageOperation.findByIdAndDelete(pageOpId);
  }

  /**
   * V4 compatible create method
   */
  private async createV4(path, body, user, options: any = {}) {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    const format = options.format || 'markdown';
    const grantUserGroupIds = options.grantUserGroupIds || null;
    const expandContentWidth = configManager.getConfig(
      'customize:isContainerFluid',
    );

    // sanitize path
    path = generalXssFilter.process(path); // eslint-disable-line no-param-reassign

    let grant = options.grant;
    // force public
    if (isTopPage(path)) {
      grant = PageGrant.GRANT_PUBLIC;
    }

    const isExist = await Page.count({ path });

    if (isExist) {
      throw new Error('Cannot create new page to existed path');
    }

    const page = new Page();
    page.path = path;
    page.creator = user;
    page.lastUpdateUser = user;
    page.status = PageStatus.STATUS_PUBLISHED;
    if (expandContentWidth != null) {
      page.expandContentWidth = expandContentWidth;
    }
    await this.validateAppliedScope(user, grant, grantUserGroupIds);
    page.applyScope(user, grant, grantUserGroupIds);

    let savedPage = await page.save();
    const newRevision = Revision.prepareRevision(
      savedPage,
      body,
      null,
      user,
      undefined,
      { format },
    );
    savedPage = await pushRevision(savedPage, newRevision, user);
    await savedPage.populateDataToShowRevision();

    this.pageEvent.emit('create', savedPage, user);

    // update scopes for descendants
    if (options.overwriteScopesOfDescendants) {
      this.applyScopesToDescendantsWithStream(savedPage, user, true);
    }

    return savedPage;
  }

  private async canProcessForceCreateBySystem(
    path: string,
    grantData: {
      grant: PageGrant;
      grantUserIds?: ObjectIdLike[];
      grantUserGroupId?: ObjectIdLike;
    },
  ): Promise<boolean> {
    return this.canProcessCreate(path, grantData, false);
  }

  private async disableAncestorPagesTtl(path: string): Promise<void> {
    const Page = mongoose.model<PageDocument, PageModel>('Page');

    const ancestorPaths = collectAncestorPaths(path);
    const ancestorPageIds = await Page.aggregate([
      { $match: { path: { $in: ancestorPaths, $nin: ['/'] }, isEmpty: false } },
      { $project: { _id: 1 } },
    ]);

    await Page.updateMany(
      { _id: { $in: ancestorPageIds } },
      { $unset: { ttlTimestamp: true } },
    );
  }

  /**
   * @private
   * This method receives the same arguments as the PageService.create method does except for the added type '{ grantUserIds?: ObjectIdLike[] }'.
   * This additional value is used to determine the grantedUser of the page to be created by system.
   * This method must not run isGrantNormalized method to validate grant. **If necessary, run it before use this method.**
   * -- Reason 1: This is because it is not expected to use this method when the grant validation is required.
   * -- Reason 2: This is because it is not expected to use this method when the program cannot determine the operator.
   */
  async forceCreateBySystem(
    path: string,
    body: string,
    options: IOptionsForCreate & { grantUserIds?: ObjectIdLike[] },
  ): Promise<PageDocument> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const isV5Compatible = configManager.getConfig('app:isV5Compatible');
    if (!isV5Compatible) {
      throw Error('This method is available only when v5 compatible');
    }

    // Values
    // eslint-disable-next-line no-param-reassign
    path = generalXssFilter.process(path); // sanitize path

    const { grantUserGroupIds, grantUserIds } = options;
    const grant = isTopPage(path) ? Page.GRANT_PUBLIC : options.grant;

    const isGrantRestricted = grant === Page.GRANT_RESTRICTED;
    const isGrantOwner = grant === Page.GRANT_OWNER;

    const grantData = {
      grant,
      grantUserIds: isGrantOwner ? grantUserIds : undefined,
      grantUserGroupIds,
    };

    // Validate
    if (isGrantOwner && grantUserIds?.length !== 1) {
      throw Error('grantedUser must exist when grant is GRANT_OWNER');
    }
    const canProcessForceCreateBySystem =
      await this.canProcessForceCreateBySystem(path, grantData);
    if (!canProcessForceCreateBySystem) {
      throw Error('Cannot process forceCreateBySystem');
    }

    // Prepare a page document
    const shouldNew = isGrantRestricted;
    const page = await this.preparePageDocumentToCreate(path, shouldNew);

    // Set field
    this.setFieldExceptForGrantRevisionParent(page, path);

    // Apply scope
    page.applyScope({ _id: grantUserIds?.[0] }, grant, grantUserGroupIds);

    // Set parent
    if (isTopPage(path) || isGrantRestricted) {
      // set parent to null when GRANT_RESTRICTED
      page.parent = null;
    } else {
      const parent = await this.getParentAndFillAncestorsBySystem(path);
      page.parent = parent._id;
    }

    // Save
    let savedPage = await page.save();

    // Create revision
    const dummyUser: HasObjectId = {
      _id: new mongoose.Types.ObjectId().toString(),
    };
    const newRevision = Revision.prepareRevision(
      savedPage,
      body,
      null,
      dummyUser,
    );
    savedPage = await pushRevision(savedPage, newRevision, dummyUser);

    if (savedPage._id == null) {
      throw new Error('Something went wrong: _id is null');
    }

    // Update descendantCount
    await this.updateDescendantCountOfAncestors(savedPage._id, 1, false);

    // Emit create event
    this.pageEvent.emit('create', savedPage, dummyUser);

    return savedPage;
  }

  private shouldUseUpdatePageV4(
    grant: number,
    isV5Compatible: boolean,
    isOnTree: boolean,
  ): boolean {
    const isRestricted = grant === PageGrant.GRANT_RESTRICTED;
    return !isRestricted && (!isV5Compatible || !isOnTree);
  }

  /**
   * A wrapper method of updatePage for updating grant only.
   */
  async updateGrant(
    page: HydratedDocument<PageDocument>,
    user: IUserHasId,
    grantData: { grant: PageGrant; userRelatedGrantedGroups: IGrantedGroup[] },
  ): Promise<PageDocument> {
    const { grant, userRelatedGrantedGroups } = grantData;

    const options: IOptionsForUpdate = {
      grant,
      userRelatedGrantUserGroupIds: userRelatedGrantedGroups,
    };

    return this.updatePage(page, null, null, user, options);
  }

  async updatePageSubOperation(
    page,
    user,
    exPage,
    options: IOptionsForUpdate,
    pageOpId: ObjectIdLike,
  ): Promise<void> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    const currentPage = page;

    const exParent = exPage.parent;
    const wasOnTree = exPage.parent != null || isTopPage(exPage.path);
    const shouldBeOnTree = currentPage.grant !== PageGrant.GRANT_RESTRICTED;
    const isChildrenExist = await Page.count({
      path: new RegExp(
        `^${escapeStringRegexp(addTrailingSlash(currentPage.path))}`,
      ),
      parent: { $ne: null },
    });

    // 1. Update descendantCount
    const shouldPlusDescCount = !wasOnTree && shouldBeOnTree;
    const shouldMinusDescCount = wasOnTree && !shouldBeOnTree;
    if (shouldPlusDescCount) {
      await this.updateDescendantCountOfAncestors(currentPage._id, 1, false);
      const newDescendantCount = await Page.recountDescendantCount(
        currentPage._id,
      );
      await Page.updateOne(
        { _id: currentPage._id },
        { descendantCount: newDescendantCount },
      );
    } else if (shouldMinusDescCount) {
      // Update from parent. Parent is null if currentPage.grant is RESTRECTED.
      if (currentPage.grant === PageGrant.GRANT_RESTRICTED) {
        await this.updateDescendantCountOfAncestors(exParent, -1, true);
      }
    }

    // 2. Delete unnecessary empty pages
    const shouldRemoveLeafEmpPages = wasOnTree && !isChildrenExist;
    if (shouldRemoveLeafEmpPages) {
      await Page.removeLeafEmptyPagesRecursively(exParent);
    }

    // 3. Update scopes for descendants
    if (options.overwriteScopesOfDescendants && shouldBeOnTree) {
      await this.applyScopesToDescendantsWithStream(currentPage, user);
    }

    await PageOperation.findByIdAndDelete(pageOpId);
  }

  /**
   * Get the new GrantedGroups for the page going through an update operation.
   * It will include the groups specified by the operator, and groups which the user does not belong to, but was related to the page before the update.
   * @param userRelatedGrantedGroups The groups specified by the operator
   * @param page The page going through an update operation
   * @param user The operator
   * @returns The new GrantedGroups array to be set to the page
   */
  async getNewGrantedGroups(
    userRelatedGrantedGroups: IGrantedGroup[],
    page: PageDocument,
    user,
  ): Promise<IGrantedGroup[]> {
    const userRelatedGroups =
      await this.pageGrantService.getUserRelatedGroups(user);
    return this.getNewGrantedGroupsSyncronously(
      userRelatedGroups,
      userRelatedGrantedGroups,
      page,
    );
  }

  /**
   * Use when you do not want to use getNewGrantedGroups with async/await (e.g inside loops that process a large amount of pages)
   * Specification of userRelatedGroups is necessary to avoid the cost of fetching userRelatedGroups from DB every time.
   */
  getNewGrantedGroupsSyncronously(
    userRelatedGroups: PopulatedGrantedGroup[],
    userRelatedGrantedGroups: IGrantedGroup[],
    page: PageDocument,
  ): IGrantedGroup[] {
    const previousGrantedGroups = page.grantedGroups;
    const userRelatedPreviousGrantedGroups = this.pageGrantService
      .getUserRelatedGrantedGroupsSyncronously(userRelatedGroups, page)
      .map((g) => getIdForRef(g.item));
    const userUnrelatedPreviousGrantedGroups = previousGrantedGroups.filter(
      (g) => !userRelatedPreviousGrantedGroups.includes(getIdForRef(g.item)),
    );
    return [...userUnrelatedPreviousGrantedGroups, ...userRelatedGrantedGroups];
  }

  // There are cases where "revisionId" is not required for revision updates
  // See: https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1
  async updatePage(
    pageData: HydratedDocument<PageDocument>,
    body: string | null,
    previousBody: string | null,
    user: IUserHasId,
    options: IOptionsForUpdate = {},
  ): Promise<HydratedDocument<PageDocument>> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    const wasOnTree = pageData.parent != null || isTopPage(pageData.path);
    const isV5Compatible = configManager.getConfig('app:isV5Compatible');

    const shouldUseV4Process = this.shouldUseUpdatePageV4(
      pageData.grant,
      isV5Compatible,
      wasOnTree,
    );
    if (shouldUseV4Process) {
      // v4 compatible process
      return this.updatePageV4(pageData, body, previousBody, user, options);
    }

    // Clone page document
    const clonedPageData = Page.hydrate(pageData.toObject());
    const newPageData = pageData;

    // Once updated it's exempt from automatic deletion
    if (options.wip == null) {
      newPageData.ttlTimestamp = undefined;
    } else if (options.wip) {
      newPageData.unpublish();
    } else {
      newPageData.publish();
    }

    // use the previous data if absent
    const grant = options.grant ?? clonedPageData.grant;
    const grantUserGroupIds =
      options.userRelatedGrantUserGroupIds != null
        ? await this.getNewGrantedGroups(
            options.userRelatedGrantUserGroupIds,
            clonedPageData,
            user,
          )
        : clonedPageData.grantedGroups;

    const grantedUserIds = clonedPageData.grantedUserIds || [user._id];
    const shouldBeOnTree = grant !== PageGrant.GRANT_RESTRICTED;
    const isChildrenExist = await Page.count({
      path: new RegExp(
        `^${escapeStringRegexp(addTrailingSlash(clonedPageData.path))}`,
      ),
      parent: { $ne: null },
    });

    const isGrantChangeable = await this.pageGrantService.validateGrantChange(
      user,
      pageData.grantedGroups,
      grant,
      grantUserGroupIds,
    );
    if (!isGrantChangeable) {
      throw Error(
        'The selected grant or grantedGroup is not assignable to this page.',
      );
    }

    if (shouldBeOnTree) {
      let isGrantNormalized = false;
      try {
        const shouldCheckDescendants = !options.overwriteScopesOfDescendants;
        // eslint-disable-next-line max-len
        isGrantNormalized = await this.pageGrantService.isGrantNormalized(
          user,
          clonedPageData.path,
          grant,
          grantedUserIds,
          grantUserGroupIds,
          shouldCheckDescendants,
          false,
        );
      } catch (err) {
        logger.error(
          `Failed to validate grant of page at "${clonedPageData.path}" of grant ${grant}:`,
          err,
        );
        throw err;
      }
      if (!isGrantNormalized) {
        throw Error(
          'The selected grant or grantedGroup is not assignable to this page.',
        );
      }

      if (options.overwriteScopesOfDescendants) {
        const updateGrantInfo =
          await this.pageGrantService.generateUpdateGrantInfoToOverwriteDescendants(
            user,
            grant,
            options.userRelatedGrantUserGroupIds,
          );
        const canOverwriteDescendants =
          await this.pageGrantService.canOverwriteDescendants(
            clonedPageData.path,
            user,
            updateGrantInfo,
          );

        if (!canOverwriteDescendants) {
          throw Error('Cannot overwrite scopes of descendants.');
        }
      }

      if (!wasOnTree) {
        const newParent = await this.getParentAndFillAncestorsByUser(
          user,
          newPageData.path,
        );
        newPageData.parent = newParent._id;
      }
    } else {
      if (wasOnTree && isChildrenExist) {
        // Update children's parent with new parent
        const newParentForChildren = await Page.createEmptyPage(
          clonedPageData.path,
          clonedPageData.parent,
          clonedPageData.descendantCount,
        );
        await Page.updateMany(
          { parent: clonedPageData._id },
          { parent: newParentForChildren._id },
        );
      }

      newPageData.parent = null;
      newPageData.descendantCount = 0;
    }

    newPageData.applyScope(user, grant, grantUserGroupIds);

    // update existing page
    let savedPage = await newPageData.save();

    // Update body
    const isBodyPresent = body != null;
    const shouldUpdateBody = isBodyPresent;
    if (shouldUpdateBody) {
      const origin = options.origin;
      const newRevision = await Revision.prepareRevision(
        newPageData,
        body,
        previousBody,
        user,
        origin,
      );
      savedPage = await pushRevision(savedPage, newRevision, user);
      await savedPage.populateDataToShowRevision();
    }

    this.pageEvent.emit('update', savedPage, user);

    // Update ex children's parent
    if (!wasOnTree && shouldBeOnTree) {
      const emptyPageAtSamePath = await Page.findOne({
        path: clonedPageData.path,
        isEmpty: true,
      }); // this page is necessary to find children

      if (isChildrenExist) {
        if (emptyPageAtSamePath != null) {
          // Update children's parent with new parent
          await Page.updateMany(
            { parent: emptyPageAtSamePath._id },
            { parent: savedPage._id },
          );
        }
      }

      await Page.findOneAndDelete({ path: clonedPageData.path, isEmpty: true }); // delete here
    }

    // Directly run sub operation for now since it might be complex to handle main operation for updating pages -- Taichi Masuyama 2022.11.08
    let pageOp: PageOperationDocument;
    try {
      pageOp = await PageOperation.create({
        actionType: PageActionType.Update,
        actionStage: PageActionStage.Sub,
        page: savedPage,
        exPage: clonedPageData,
        user,
        fromPath: clonedPageData.path,
        options,
      });
    } catch (err) {
      logger.error('Failed to create PageOperation document.', err);
      throw err;
    }

    this.updatePageSubOperation(
      savedPage,
      user,
      clonedPageData,
      options,
      pageOp._id,
    );

    return savedPage;
  }

  // There are cases where "revisionId" is not required for revision updates
  // See: https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1
  async updatePageV4(
    pageData: HydratedDocument<PageDocument>,
    body,
    previousBody,
    user,
    options: IOptionsForUpdate = {},
  ): Promise<HydratedDocument<PageDocument>> {
    // use the previous data if absent
    const grant = options.grant || pageData.grant;
    const grantUserGroupIds =
      options.userRelatedGrantUserGroupIds != null
        ? await this.getNewGrantedGroups(
            options.userRelatedGrantUserGroupIds,
            pageData,
            user,
          )
        : pageData.grantedGroups;

    // validate multiple group grant before save using pageData and options
    await this.pageGrantService.validateGrantChange(
      user,
      pageData.grantedGroups,
      grant,
      grantUserGroupIds,
    );

    await this.validateAppliedScope(user, grant, grantUserGroupIds);
    pageData.applyScope(user, grant, grantUserGroupIds);

    // update existing page
    let savedPage = await pageData.save();

    // Update revision
    const isBodyPresent = body != null;
    const shouldUpdateBody = isBodyPresent;
    if (shouldUpdateBody) {
      const newRevision = await Revision.prepareRevision(
        pageData,
        body,
        previousBody,
        user,
        options.origin,
      );
      savedPage = await pushRevision(savedPage, newRevision, user);
      await savedPage.populateDataToShowRevision();
    }

    // update scopes for descendants
    if (options.overwriteScopesOfDescendants) {
      this.applyScopesToDescendantsWithStream(savedPage, user, true);
    }

    this.pageEvent.emit('update', savedPage, user);

    return savedPage;
  }

  /**
   * Find all pages in trash page
   */
  async findAllTrashPages(
    user: IUserHasId,
    userGroups = null,
  ): Promise<HydratedDocument<IPage>[]> {
    const Page = mongoose.model('Page') as unknown as PageModel;

    // https://regex101.com/r/KYZWls/1
    // ex. /trash/.*
    const regexp = /^\/trash\/.*$/;
    const queryBuilder = new PageQueryBuilder(
      Page.find({ path: { $regex: regexp } }),
      true,
    );

    await queryBuilder.addViewerCondition(user, userGroups);

    const pages: HydratedDocument<IPage>[] = await queryBuilder
      .addConditionToSortPagesByAscPath()
      .query.lean()
      .exec();

    return pages;
  }

  async getYjsData(pageId: string): Promise<CurrentPageYjsData> {
    const yjsService = getYjsService();

    const currentYdoc = yjsService.getCurrentYdoc(pageId);
    const ydocStatus = await yjsService.getYDocStatus(pageId);
    const hasYdocsNewerThanLatestRevision = ydocStatus === YDocStatus.DRAFT;

    return {
      hasYdocsNewerThanLatestRevision,
      awarenessStateSize: currentYdoc?.awareness.states.size,
    };
  }

  async createTtlIndex(): Promise<void> {
    const wipPageExpirationSeconds =
      configManager.getConfig('app:wipPageExpirationSeconds') ?? 172800;
    const collection = mongoose.connection.collection('pages');

    try {
      const targetField = 'ttlTimestamp_1';

      const indexes = await collection.indexes();
      const foundTargetField = indexes.find((i) => i.name === targetField);

      const isNotSpec =
        foundTargetField?.expireAfterSeconds == null ||
        foundTargetField?.expireAfterSeconds !== wipPageExpirationSeconds;
      const shoudDropIndex = foundTargetField != null && isNotSpec;
      const shoudCreateIndex = foundTargetField == null || shoudDropIndex;

      if (shoudDropIndex) {
        await collection.dropIndex(targetField);
      }

      if (shoudCreateIndex) {
        await collection.createIndex(
          { ttlTimestamp: 1 },
          { expireAfterSeconds: wipPageExpirationSeconds },
        );
      }
    } catch (err) {
      logger.error('Failed to create TTL Index', err);
      throw err;
    }
  }
}

export default PageService;
