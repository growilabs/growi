import type { EventEmitter } from 'node:events';
import type {
  HasObjectId,
  IGrantedGroup,
  IPage,
  IPageInfoBasic,
  IUser,
  IUserHasId,
  PageGrant,
} from '@growi/core/dist/interfaces';
import type { HydratedDocument, Types } from 'mongoose';

import type { ExternalUserGroupDocument } from '~/features/external-user-group/server/models/external-user-group';
import type { IOptionsForCreate, IOptionsForUpdate } from '~/interfaces/page';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import type { PageActionOnGroupDelete } from '~/interfaces/user-group';
import type { CurrentPageYjsData } from '~/interfaces/yjs';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageDocument } from '~/server/models/page';
import type { PageOperationDocument } from '~/server/models/page-operation';
import type { UserGroupDocument } from '~/server/models/user-group';

export interface IPageService {
  create(
    path: string,
    body: string,
    user: HasObjectId,
    options: IOptionsForCreate,
  ): Promise<HydratedDocument<PageDocument>>;
  forceCreateBySystem(
    path: string,
    body: string,
    options: IOptionsForCreate,
  ): Promise<PageDocument>;
  updatePage(
    pageData: HydratedDocument<PageDocument>,
    body: string | null,
    previousBody: string | null,
    user: IUser,
    options: IOptionsForUpdate,
  ): Promise<HydratedDocument<PageDocument>>;
  updateDescendantCountOfAncestors: (
    pageId: ObjectIdLike,
    inc: number,
    shouldIncludeTarget: boolean,
  ) => Promise<void>;
  updateGrant(
    page: HydratedDocument<PageDocument>,
    user: IUserHasId,
    grantData: { grant: PageGrant; userRelatedGrantedGroups: IGrantedGroup[] },
  ): Promise<PageDocument>;
  deleteCompletelyOperation: (
    pageIds: ObjectIdLike[],
    pagePaths: string[],
  ) => Promise<void>;
  getEventEmitter: () => EventEmitter;
  deleteMultipleCompletely: (
    pages: ObjectIdLike[],
    user: IUser | undefined,
  ) => Promise<void>;
  resumeRenameSubOperation(
    renamedPage: PageDocument,
    pageOp: PageOperationDocument,
    activity?,
  ): Promise<void>;
  handlePrivatePagesForGroupsToDelete(
    groupsToDelete: UserGroupDocument[] | ExternalUserGroupDocument[],
    action: PageActionOnGroupDelete,
    transferToUserGroup: IGrantedGroup | undefined,
    user: IUser,
  ): Promise<void>;
  shortBodiesMapByPageIds(
    pageIds?: Types.ObjectId[],
    user?,
  ): Promise<Record<string, string | null>>;
  constructBasicPageInfo(
    page: HydratedDocument<PageDocument>,
    isGuestUser?: boolean,
  ): IPageInfoBasic;
  normalizeAllPublicPages(): Promise<void>;
  canDelete(
    page: PageDocument,
    creatorId: ObjectIdLike | null,
    operator: any | null,
    isRecursively: boolean,
  ): boolean;
  canDeleteCompletely(
    page: PageDocument,
    creatorId: ObjectIdLike | null,
    operator: any | null,
    isRecursively: boolean,
    userRelatedGroups: PopulatedGrantedGroup[],
  ): boolean;
  canDeleteCompletelyAsMultiGroupGrantedPage(
    page: PageDocument,
    creatorId: ObjectIdLike | null,
    operator: any | null,
    userRelatedGroups: PopulatedGrantedGroup[],
  ): boolean;
  getYjsData(
    pageId: string,
    revisionBody?: string,
  ): Promise<CurrentPageYjsData>;
  updateDescendantCountOfPagesWithPaths(paths: string[]): Promise<void>;
  revertRecursivelyMainOperation(
    page,
    user,
    options,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void>;
  revertDeletedPage(
    page,
    user,
    options,
    isRecursively: boolean,
    activityParameters?,
  );
  deleteCompletelyRecursivelyMainOperation(
    page,
    user,
    options,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void>;
  deleteCompletely(
    page,
    user,
    options,
    isRecursively: boolean,
    preventEmitting: boolean,
    activityParameters,
  );
  deleteRecursivelyMainOperation(
    page,
    user,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void>;
  deletePage(page, user, options, isRecursively: boolean, activityParameters);
  duplicateRecursivelyMainOperation(
    page: PageDocument,
    newPagePath: string,
    user,
    pageOpId: ObjectIdLike,
    onlyDuplicateUserRelatedResources: boolean,
  ): Promise<void>;
  duplicate(
    page: PageDocument,
    newPagePath: string,
    user,
    isRecursively: boolean,
    onlyDuplicateUserRelatedResources: boolean,
  );
  renameSubOperation(
    page,
    newPagePath: string,
    user,
    options,
    renamedPage,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<void>;
  renamePage(
    page: IPage,
    newPagePath,
    user,
    options,
    activityParameters,
  ): Promise<PageDocument | null>;
  renameMainOperation(
    page,
    newPagePath: string,
    user,
    options,
    pageOpId: ObjectIdLike,
    activity?,
  ): Promise<PageDocument | null>;
  createSubOperation(
    page,
    user,
    options: IOptionsForCreate,
    pageOpId: ObjectIdLike,
  ): Promise<void>;

  getCreatorIdForCanDelete(page: PageDocument): Promise<ObjectIdLike | null>;

  canDeleteUserHomepageByConfig(): boolean;

  isUsersHomepageOwnerAbsent(path: string): Promise<boolean>;
}
