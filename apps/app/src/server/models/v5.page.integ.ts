import assert from 'node:assert';
import {
  GroupType,
  getIdForRef,
  type IGrantedGroup,
  type IRevision,
  type IUser,
  PageGrant,
} from '@growi/core/dist/interfaces';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { CommentModel } from '~/features/comment/server';
import { ExternalGroupProviderType } from '~/features/external-user-group/interfaces/external-user-group';
import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { IBookmark } from '~/interfaces/bookmark-info';
import type { IComment } from '~/interfaces/comment';
import { PageActionType } from '~/interfaces/page-operation';
import type { IShareLink } from '~/interfaces/share-link';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';

import type { IPageService } from '../service/page';
import type { BookmarkModel } from './bookmark';
import type { IPageRedirect, PageRedirectModel } from './page-redirect';
import type { ShareLinkModel } from './share-link';

describe('Page', () => {
  let crowi: Crowi;
  let pageService: IPageService;

  let Page: PageModel;
  let Revision: Model<IRevision>;
  let Bookmark: BookmarkModel;
  let Comment: CommentModel;
  let User: Model<IUser>;
  let ShareLink: ShareLinkModel;
  let PageRedirect: PageRedirectModel;
  let PageOperation: PageOperationModel;

  let rootPage: PageDocument;
  let dummyUser1: HydratedDocument<IUser>;
  let pModelUser1: HydratedDocument<IUser>;
  let pModelUser2: HydratedDocument<IUser>;
  let pModelUser3: HydratedDocument<IUser>;
  let userGroupIdPModelIsolate: mongoose.Types.ObjectId;
  let userGroupIdPModelA: mongoose.Types.ObjectId;
  let userGroupIdPModelB: mongoose.Types.ObjectId;
  let userGroupIdPModelC: mongoose.Types.ObjectId;
  let externalUserGroupIdPModelIsolate: mongoose.Types.ObjectId;
  let externalUserGroupIdPModelA: mongoose.Types.ObjectId;
  let externalUserGroupIdPModelB: mongoose.Types.ObjectId;
  let externalUserGroupIdPModelC: mongoose.Types.ObjectId;

  // To test updatePage overwriting descendants (prefix `upod`)
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodUserA: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodUserB: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodUserC: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodGroupAB: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodGroupA: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodGroupAIsolated: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodGroupB: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let upodGroupC: any;
  const upodUserGroupIdA = new mongoose.Types.ObjectId();
  const upodUserGroupIdAIsolated = new mongoose.Types.ObjectId();
  const upodUserGroupIdB = new mongoose.Types.ObjectId();
  const upodUserGroupIdC = new mongoose.Types.ObjectId();
  const upodUserGroupIdAB = new mongoose.Types.ObjectId();
  const upodExternalUserGroupIdA = new mongoose.Types.ObjectId();
  const upodExternalUserGroupIdAIsolated = new mongoose.Types.ObjectId();
  const upodExternalUserGroupIdB = new mongoose.Types.ObjectId();
  const upodExternalUserGroupIdC = new mongoose.Types.ObjectId();
  const upodExternalUserGroupIdAB = new mongoose.Types.ObjectId();
  const upodPageIdgAB1 = new mongoose.Types.ObjectId();
  const upodPageIdPublic2 = new mongoose.Types.ObjectId();
  const upodPageIdPublic3 = new mongoose.Types.ObjectId();
  const upodPageIdPublic4 = new mongoose.Types.ObjectId();
  const upodPageIdPublic5 = new mongoose.Types.ObjectId();
  const upodPageIdPublic6 = new mongoose.Types.ObjectId();

  // Since updatePageSubOperation is asynchronously called from updatePage,
  // we use a polling pattern to wait for the async operation to complete.
  // The PageOperation document is deleted when updatePageSubOperation finishes.
  const updatePage = async (
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    page: any,
    newRevisionBody: string,
    oldRevisionBody: string,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    user: any,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    options: any = {},
  ) => {
    const fromPath = page.path;

    const savedPage = await pageService.updatePage(
      page,
      newRevisionBody,
      oldRevisionBody,
      user,
      options,
    );

    // Wait for the async updatePageSubOperation to complete by polling PageOperation
    const startTime = Date.now();
    const maxWaitMs = 5000;
    while (Date.now() - startTime < maxWaitMs) {
      const op = await PageOperation.findOne({
        fromPath,
        actionType: PageActionType.Update,
      });
      if (op == null) {
        break; // Operation completed
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return savedPage;
  };

  const createDocumentsToTestUpdatePageOverwritingDescendants = async () => {
    // Users
    await User.insertMany([
      {
        name: 'upodUserA',
        username: 'upodUserA',
        email: 'upoduserA@example.com',
      },
      {
        name: 'upodUserB',
        username: 'upodUserB',
        email: 'upoduserB@example.com',
      },
      {
        name: 'upodUserC',
        username: 'upodUserC',
        email: 'upodUserC@example.com',
      },
    ]);

    upodUserA = await User.findOne({ username: 'upodUserA' });
    upodUserB = await User.findOne({ username: 'upodUserB' });
    upodUserC = await User.findOne({ username: 'upodUserC' });

    await UserGroup.insertMany([
      {
        _id: upodUserGroupIdAB,
        name: 'upodGroupAB',
        parent: null,
      },
      {
        _id: upodUserGroupIdA,
        name: 'upodGroupA',
        parent: upodUserGroupIdAB,
      },
      {
        _id: upodUserGroupIdAIsolated,
        name: 'upodGroupAIsolated',
        parent: null,
      },
      {
        _id: upodUserGroupIdB,
        name: 'upodGroupB',
        parent: upodUserGroupIdAB,
      },
      {
        _id: upodUserGroupIdC,
        name: 'upodGroupC',
        parent: null,
      },
    ]);

    upodGroupAB = await UserGroup.findOne({ name: 'upodGroupAB' });
    upodGroupA = await UserGroup.findOne({ name: 'upodGroupA' });
    upodGroupAIsolated = await UserGroup.findOne({
      name: 'upodGroupAIsolated',
    });
    upodGroupB = await UserGroup.findOne({ name: 'upodGroupB' });
    upodGroupC = await UserGroup.findOne({ name: 'upodGroupC' });

    // UserGroupRelations
    await UserGroupRelation.insertMany([
      {
        relatedGroup: upodUserGroupIdAB,
        relatedUser: upodUserA._id,
      },
      {
        relatedGroup: upodUserGroupIdAB,
        relatedUser: upodUserB._id,
      },
      {
        relatedGroup: upodUserGroupIdA,
        relatedUser: upodUserA._id,
      },
      {
        relatedGroup: upodUserGroupIdAIsolated,
        relatedUser: upodUserA._id,
      },
      {
        relatedGroup: upodUserGroupIdB,
        relatedUser: upodUserB._id,
      },
      {
        relatedGroup: upodUserGroupIdC,
        relatedUser: upodUserC._id,
      },
    ]);

    // Insert ExternalUserGroups with the same group structure as UserGroups
    // Use to test
    //   - ExternalUserGroup
    //   - Case of multiple grantedGroups for Page
    await ExternalUserGroup.insertMany([
      {
        _id: upodExternalUserGroupIdAB,
        name: 'upodExternalGroupAB',
        parent: null,
        externalId: 'upodExternalGroupAB',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: upodExternalUserGroupIdA,
        name: 'upodExternalGroupA',
        parent: upodExternalUserGroupIdAB,
        externalId: 'upodExternalGroupA',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: upodExternalUserGroupIdAIsolated,
        name: 'upodExternalGroupAIsolated',
        parent: null,
        externalId: 'upodExternalGroupAIsolated',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: upodExternalUserGroupIdB,
        name: 'upodExternalGroupB',
        parent: upodExternalUserGroupIdAB,
        externalId: 'upodExternalGroupB',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: upodExternalUserGroupIdC,
        name: 'upodExternalGroupC',
        parent: null,
        externalId: 'upodExternalGroupC',
        provider: ExternalGroupProviderType.ldap,
      },
    ]);

    // ExternalUserGroupRelations
    await ExternalUserGroupRelation.insertMany([
      {
        relatedGroup: upodExternalUserGroupIdAB,
        relatedUser: upodUserA._id,
      },
      {
        relatedGroup: upodExternalUserGroupIdAB,
        relatedUser: upodUserB._id,
      },
      {
        relatedGroup: upodExternalUserGroupIdA,
        relatedUser: upodUserA._id,
      },
      {
        relatedGroup: upodExternalUserGroupIdAIsolated,
        relatedUser: upodUserA._id,
      },
      {
        relatedGroup: upodExternalUserGroupIdB,
        relatedUser: upodUserB._id,
      },
      {
        relatedGroup: upodExternalUserGroupIdC,
        relatedUser: upodUserC._id,
      },
    ]);

    // Pages
    await Page.insertMany([
      // case 1
      {
        _id: upodPageIdgAB1,
        path: '/gAB_upod_1', // to GRANT_PUBLIC
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdAB, type: GroupType.userGroup },
          {
            item: upodExternalUserGroupIdAB,
            type: GroupType.externalUserGroup,
          },
        ],
        parent: rootPage._id,
      },
      {
        path: '/gAB_upod_1/gB_upod_1',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserB,
        lastUpdateUser: upodUserB,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdB, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdB, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdgAB1,
      },
      {
        path: '/gAB_upod_1/onlyB_upod_1',
        grant: PageGrant.GRANT_OWNER,
        creator: upodUserB,
        lastUpdateUser: upodUserB,
        grantedUsers: [upodUserB._id],
        grantedGroups: [],
        parent: upodPageIdgAB1,
      },
      // grant user A and B with independent groups
      {
        path: '/gAB_upod_1/gA_gB_upod_1',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdA, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdA, type: GroupType.externalUserGroup },
          { item: upodUserGroupIdB, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdB, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdgAB1,
      },
      // case 2
      {
        _id: upodPageIdPublic2,
        path: '/public_upod_2', // to Anything
        grant: PageGrant.GRANT_PUBLIC,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [],
        parent: rootPage._id,
      },
      {
        path: '/public_upod_2/gA_upod_2',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdA, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdA, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdPublic2,
      },
      {
        path: '/public_upod_2/gAIsolated_upod_2',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdAIsolated, type: GroupType.userGroup },
          {
            item: upodExternalUserGroupIdAIsolated,
            type: GroupType.externalUserGroup,
          },
        ],
        parent: upodPageIdPublic2,
      },
      {
        path: '/public_upod_2/onlyA_upod_2',
        grant: PageGrant.GRANT_OWNER,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: [upodUserA._id],
        grantedGroups: [],
        parent: upodPageIdPublic2,
      },
      // case 3
      {
        _id: upodPageIdPublic3,
        path: '/public_upod_3', // to GRANT_USER_GROUP with upodGroupAB
        grant: PageGrant.GRANT_PUBLIC,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [],
        parent: rootPage._id,
      },
      // grant user A and B with a single group
      // (external group is extra for testing external groups)
      {
        path: '/public_upod_3/gAB_upod_3',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdAB, type: GroupType.userGroup },
          {
            item: upodExternalUserGroupIdAB,
            type: GroupType.externalUserGroup,
          },
        ],
        parent: upodPageIdPublic3,
      },
      // grant user A and B with independent groups
      {
        path: '/public_upod_3/gA_gB_upod_3',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdA, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdA, type: GroupType.externalUserGroup },
          { item: upodUserGroupIdB, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdB, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdPublic3,
      },
      {
        path: '/public_upod_3/gB_upod_3',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserB,
        lastUpdateUser: upodUserB,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdB, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdB, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdPublic3,
      },
      {
        path: '/public_upod_3/onlyB_upod_3',
        grant: PageGrant.GRANT_OWNER,
        creator: upodUserB,
        lastUpdateUser: upodUserB,
        grantedUsers: [upodUserB._id],
        grantedGroups: [],
        parent: upodPageIdPublic3,
      },
      // case 4
      {
        _id: upodPageIdPublic4,
        path: '/public_upod_4', // to GRANT_USER_GROUP with upodGroupAB
        grant: PageGrant.GRANT_PUBLIC,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [],
        parent: rootPage._id,
      },
      {
        path: '/public_upod_4/gA_upod_4',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdA, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdA, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdPublic4,
      },
      {
        path: '/public_upod_4/gC_upod_4',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserC,
        lastUpdateUser: upodUserC,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdC, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdC, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdPublic4,
      },
      // case 5
      {
        _id: upodPageIdPublic5,
        path: '/public_upod_5', // to GRANT_USER_GROUP with upodGroupAB
        grant: PageGrant.GRANT_PUBLIC,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [],
        parent: rootPage._id,
      },
      {
        path: '/public_upod_5/gA_upod_5',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [
          { item: upodUserGroupIdA, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdA, type: GroupType.externalUserGroup },
        ],
        parent: upodPageIdPublic5,
      },
      {
        path: '/public_upod_5/onlyC_upod_5',
        grant: PageGrant.GRANT_OWNER,
        creator: upodUserC,
        lastUpdateUser: upodUserC,
        grantedUsers: [upodUserC._id],
        grantedGroups: [],
        parent: upodPageIdPublic5,
      },
      // case 6
      {
        _id: upodPageIdPublic6,
        path: '/public_upod_6', // to GRANT_USER_GROUP with upodGroupAB
        grant: PageGrant.GRANT_PUBLIC,
        creator: upodUserA,
        lastUpdateUser: upodUserA,
        grantedUsers: null,
        grantedGroups: [],
        parent: rootPage._id,
      },
      {
        path: '/public_upod_6/onlyC_upod_6',
        grant: PageGrant.GRANT_OWNER,
        creator: upodUserC,
        lastUpdateUser: upodUserC,
        grantedUsers: [upodUserC._id],
        grantedGroups: [],
        parent: upodPageIdPublic6,
      },
    ]);
  };

  // normalize for result comparison
  const normalizeGrantedGroups = (
    grantedGroups: IGrantedGroup[] | undefined,
  ) => {
    return grantedGroups?.map((group) => {
      return { item: getIdForRef(group.item), type: group.type };
    });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    pageService = crowi.pageService;

    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    vi.restoreAllMocks();
    User = mongoose.model('User');
    Page = mongoose.model('Page') as PageModel;
    Revision = mongoose.model('Revision');
    Bookmark = mongoose.model<IBookmark, BookmarkModel>('Bookmark');
    Comment = mongoose.model<IComment, CommentModel>('Comment');
    ShareLink = mongoose.model<IShareLink, ShareLinkModel>('ShareLink');
    PageRedirect = mongoose.model<IPageRedirect, PageRedirectModel>(
      'PageRedirect',
    );
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );

    // Create dummy user if it doesn't exist
    const existingUser1 = await User.findOne({ username: 'v5DummyUser1' });
    if (existingUser1 == null) {
      await User.insertMany([
        {
          name: 'v5DummyUser1',
          username: 'v5DummyUser1',
          email: 'v5dummyuser1@example.com',
        },
      ]);
    }
    const foundDummyUser1 = await User.findOne({ username: 'v5DummyUser1' });
    assert(foundDummyUser1 != null);
    dummyUser1 = foundDummyUser1;

    // Ensure root page exists
    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      const rootPageId = new mongoose.Types.ObjectId();
      rootPage = await Page.create({
        _id: rootPageId,
        path: '/',
        grant: PageGrant.GRANT_PUBLIC,
      });
    } else {
      rootPage = existingRootPage;
    }

    const pModelUserId1 = new mongoose.Types.ObjectId();
    const pModelUserId2 = new mongoose.Types.ObjectId();
    const pModelUserId3 = new mongoose.Types.ObjectId();
    await User.insertMany([
      {
        _id: pModelUserId1,
        name: 'pmodelUser1',
        username: 'pmodelUser1',
        email: 'pmodelUser1@example.com',
      },
      {
        _id: pModelUserId2,
        name: 'pmodelUser2',
        username: 'pmodelUser2',
        email: 'pmodelUser2@example.com',
      },
      {
        _id: pModelUserId3,
        name: 'pModelUser3',
        username: 'pModelUser3',
        email: 'pModelUser3@example.com',
      },
    ]);
    const foundPModelUser1 = await User.findOne({ _id: pModelUserId1 });
    const foundPModelUser2 = await User.findOne({ _id: pModelUserId2 });
    const foundPModelUser3 = await User.findOne({ _id: pModelUserId3 });
    assert(foundPModelUser1 != null);
    assert(foundPModelUser2 != null);
    assert(foundPModelUser3 != null);
    pModelUser1 = foundPModelUser1;
    pModelUser2 = foundPModelUser2;
    pModelUser3 = foundPModelUser3;

    userGroupIdPModelIsolate = new mongoose.Types.ObjectId();
    userGroupIdPModelA = new mongoose.Types.ObjectId();
    userGroupIdPModelB = new mongoose.Types.ObjectId();
    userGroupIdPModelC = new mongoose.Types.ObjectId();
    await UserGroup.insertMany([
      {
        _id: userGroupIdPModelIsolate,
        name: 'pModel_groupIsolate',
      },
      {
        _id: userGroupIdPModelA,
        name: 'pModel_groupA',
      },
      {
        _id: userGroupIdPModelB,
        name: 'pModel_groupB',
        parent: userGroupIdPModelA,
      },
      {
        _id: userGroupIdPModelC,
        name: 'pModel_groupC',
        parent: userGroupIdPModelB,
      },
    ]);

    await UserGroupRelation.insertMany([
      {
        relatedGroup: userGroupIdPModelIsolate,
        relatedUser: pModelUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: userGroupIdPModelIsolate,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: userGroupIdPModelA,
        relatedUser: pModelUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: userGroupIdPModelA,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: userGroupIdPModelA,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: userGroupIdPModelB,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: userGroupIdPModelB,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: userGroupIdPModelC,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
    ]);

    // Insert ExternalUserGroups with the same group structure as UserGroups
    // Use to test
    //   - ExternalUserGroup
    //   - Case of multiple grantedGroups for Page
    externalUserGroupIdPModelIsolate = new mongoose.Types.ObjectId();
    externalUserGroupIdPModelA = new mongoose.Types.ObjectId();
    externalUserGroupIdPModelB = new mongoose.Types.ObjectId();
    externalUserGroupIdPModelC = new mongoose.Types.ObjectId();
    await ExternalUserGroup.insertMany([
      {
        _id: externalUserGroupIdPModelIsolate,
        name: 'pModel_externalGroupIsolate',
        externalId: 'pModel_externalGroupIsolate',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: externalUserGroupIdPModelA,
        name: 'pModel_externalGroupA',
        externalId: 'pModel_externalGroupA',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: externalUserGroupIdPModelB,
        name: 'pModel_externalGroupB',
        parent: externalUserGroupIdPModelA,
        externalId: 'pModel_externalGroupB',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: externalUserGroupIdPModelC,
        name: 'pModel_externalGroupC',
        parent: externalUserGroupIdPModelB,
        externalId: 'pModel_externalGroupC',
        provider: ExternalGroupProviderType.ldap,
      },
    ]);

    await ExternalUserGroupRelation.insertMany([
      {
        relatedGroup: externalUserGroupIdPModelIsolate,
        relatedUser: pModelUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalUserGroupIdPModelIsolate,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalUserGroupIdPModelA,
        relatedUser: pModelUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalUserGroupIdPModelA,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalUserGroupIdPModelA,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalUserGroupIdPModelB,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalUserGroupIdPModelB,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalUserGroupIdPModelC,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
    ]);

    /**
     * update
     * mup_ => model update
     * emp => empty => page with isEmpty: true
     * pub => public => GRANT_PUBLIC
     * awl => Anyone with the link => GRANT_RESTRICTED
     */
    const pageIdUpd1 = new mongoose.Types.ObjectId();
    const pageIdUpd2 = new mongoose.Types.ObjectId();
    const pageIdUpd3 = new mongoose.Types.ObjectId();
    const pageIdUpd4 = new mongoose.Types.ObjectId();
    const pageIdUpd5 = new mongoose.Types.ObjectId();
    const pageIdUpd6 = new mongoose.Types.ObjectId();
    const pageIdUpd7 = new mongoose.Types.ObjectId();
    const pageIdUpd8 = new mongoose.Types.ObjectId();
    const pageIdUpd9 = new mongoose.Types.ObjectId();
    const pageIdUpd10 = new mongoose.Types.ObjectId();
    const pageIdUpd11 = new mongoose.Types.ObjectId();
    const pageIdUpd12 = new mongoose.Types.ObjectId();
    const pageIdUpd13 = new mongoose.Types.ObjectId();
    const pageIdUpd14 = new mongoose.Types.ObjectId();
    const pageIdUpd15 = new mongoose.Types.ObjectId();
    const pageIdUpd16 = new mongoose.Types.ObjectId();
    const pageIdUpd17 = new mongoose.Types.ObjectId();
    const pageIdUpd18 = new mongoose.Types.ObjectId();
    const pageIdUpd19 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        _id: pageIdUpd1,
        path: '/mup13_top/mup1_emp',
        grant: Page.GRANT_PUBLIC,
        parent: pageIdUpd8._id,
        isEmpty: true,
      },
      {
        _id: pageIdUpd2,
        path: '/mup13_top/mup1_emp/mup2_pub',
        grant: Page.GRANT_PUBLIC,
        parent: pageIdUpd1._id,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        _id: pageIdUpd3,
        path: '/mup14_top/mup6_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd9,
        isEmpty: false,
        descendantCount: 1,
      },
      {
        path: '/mup14_top/mup6_pub/mup7_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd3,
        isEmpty: false,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd4,
        path: '/mup15_top/mup8_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd10._id,
        isEmpty: false,
      },
      {
        _id: pageIdUpd5,
        path: '/mup16_top/mup9_pub/mup10_pub/mup11_awl',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        _id: pageIdUpd6,
        path: '/mup17_top/mup12_emp',
        isEmpty: true,
        parent: pageIdUpd12._id,
        descendantCount: 1,
      },
      {
        _id: pageIdUpd7,
        path: '/mup17_top/mup12_emp',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        path: '/mup17_top/mup12_emp/mup18_pub',
        isEmpty: false,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd6._id,
      },
      {
        _id: pageIdUpd8,
        path: '/mup13_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 2,
      },
      {
        _id: pageIdUpd9,
        path: '/mup14_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 2,
      },
      {
        _id: pageIdUpd10,
        path: '/mup15_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        _id: pageIdUpd11,
        path: '/mup16_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd12,
        path: '/mup17_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        path: '/mup19',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        path: '/mup20',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: userGroupIdPModelA, type: GroupType.userGroup },
          {
            item: externalUserGroupIdPModelA,
            type: GroupType.externalUserGroup,
          },
        ],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        path: '/mup21',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd13,
        path: '/mup22',
        grant: Page.GRANT_PUBLIC,
        creator: pModelUser1,
        lastUpdateUser: pModelUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        path: '/mup22/mup23',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: userGroupIdPModelA, type: GroupType.userGroup },
          {
            item: externalUserGroupIdPModelA,
            type: GroupType.externalUserGroup,
          },
        ],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: pageIdUpd13,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd14,
        path: '/mup24_pub',
        grant: Page.GRANT_PUBLIC,
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage,
        descendantCount: 1,
      },
      {
        path: '/mup24_pub/mup25_pub',
        grant: Page.GRANT_PUBLIC,
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: pageIdUpd14,
        descendantCount: 0,
      },
      {
        path: '/mup26_awl',
        grant: Page.GRANT_RESTRICTED,
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd15,
        path: '/mup27_pub',
        grant: Page.GRANT_PUBLIC,
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage,
        descendantCount: 1,
      },
      {
        path: '/mup27_pub/mup28_owner',
        grant: Page.GRANT_OWNER,
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: pageIdUpd15,
        grantedUsers: [pModelUserId1],
        descendantCount: 0,
      },
      {
        _id: pageIdUpd16,
        path: '/mup29_A',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: userGroupIdPModelA, type: GroupType.userGroup },
          {
            item: externalUserGroupIdPModelA,
            type: GroupType.externalUserGroup,
          },
        ],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage,
        descendantCount: 1,
      },
      {
        path: '/mup29_A/mup30_owner',
        grant: Page.GRANT_OWNER,
        grantedUsers: [pModelUserId1],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: pageIdUpd16,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd17,
        path: '/mup31_A',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: userGroupIdPModelA, type: GroupType.userGroup },
          {
            item: externalUserGroupIdPModelA,
            type: GroupType.externalUserGroup,
          },
        ],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage,
        descendantCount: 1,
      },
      {
        path: '/mup31_A/mup32_owner',
        grant: Page.GRANT_OWNER,
        grantedUsers: [pModelUserId1],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: pageIdUpd17,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd18,
        path: '/mup33_C',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: userGroupIdPModelC, type: GroupType.userGroup },
          {
            item: externalUserGroupIdPModelC,
            type: GroupType.externalUserGroup,
          },
        ],
        creator: pModelUserId3,
        lastUpdateUser: pModelUserId3,
        isEmpty: false,
        parent: rootPage,
        descendantCount: 1,
      },
      {
        path: '/mup33_C/mup34_owner',
        grant: Page.GRANT_OWNER,
        grantedUsers: [pModelUserId3],
        creator: pModelUserId3,
        lastUpdateUser: pModelUserId3,
        isEmpty: false,
        parent: pageIdUpd18,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd19,
        path: '/mup35_owner',
        grant: Page.GRANT_OWNER,
        grantedUsers: [pModelUserId1],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage,
        descendantCount: 1,
      },
      {
        path: '/mup35_owner/mup36_owner',
        grant: Page.GRANT_OWNER,
        grantedUsers: [pModelUserId1],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: pageIdUpd19,
        descendantCount: 0,
      },
      {
        path: '/mup40', // used this number to resolve conflict
        grant: Page.GRANT_OWNER,
        grantedUsers: [dummyUser1._id],
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        path: '/with_multiple_individual_granted_groups',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: userGroupIdPModelA, type: GroupType.userGroup },
          { item: userGroupIdPModelB, type: GroupType.userGroup },
        ],
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage,
      },
    ]);

    await createDocumentsToTestUpdatePageOverwritingDescendants();
  });

  describe('updatePage with overwriteScopesOfDescendants false', () => {
    describe('Changing grant from PUBLIC to RESTRICTED of', () => {
      it('an only-child page will delete its empty parent page', async () => {
        const pathT = '/mup13_top';
        const path1 = '/mup13_top/mup1_emp';
        const path2 = '/mup13_top/mup1_emp/mup2_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 2 });
        const page1 = await Page.findOne({ path: path1, isEmpty: true });
        const page2 = await Page.findOne({
          path: path2,
          grant: Page.GRANT_PUBLIC,
        });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();

        const options = {
          grant: Page.GRANT_RESTRICTED,
          userRelatedGrantUserGroupIds: null,
        };
        await updatePage(
          page2,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          options,
        );

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1 });
        const _page2 = await Page.findOne({
          path: path2,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeNull();
        expect(_page2).toBeTruthy();
        expect(_pageT?.descendantCount).toBe(1);
      });
      it('a page that has children will create an empty page with the same path and it becomes a new parent', async () => {
        const pathT = '/mup14_top';
        const path1 = '/mup14_top/mup6_pub';
        const path2 = '/mup14_top/mup6_pub/mup7_pub';
        const top = await Page.findOne({ path: pathT, descendantCount: 2 });
        const page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const page2 = await Page.findOne({
          path: path2,
          grant: Page.GRANT_PUBLIC,
        });
        expect(top).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();

        await updatePage(
          page1,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          { grant: Page.GRANT_RESTRICTED },
        );

        const _top = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        const _page2 = await Page.findOne({ path: path2 });
        const _pageN = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_pageN).toBeTruthy();

        expect(_page1?.parent).toBeNull();
        expect(_page2?.parent).toStrictEqual(_pageN?._id);
        expect(_pageN?.parent).toStrictEqual(top?._id);
        expect(_pageN?.isEmpty).toBe(true);
        expect(_pageN?.descendantCount).toBe(1);
        expect(_top?.descendantCount).toBe(1);
      });
      it('of a leaf page will NOT have an empty page with the same path', async () => {
        const pathT = '/mup15_top';
        const path1 = '/mup15_top/mup8_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 1 });
        const page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const count = await Page.countDocuments({ path: path1 });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(count).toBe(1);

        await updatePage(
          page1,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          { grant: Page.GRANT_RESTRICTED },
        );

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        const _pageNotExist = await Page.findOne({
          path: path1,
          isEmpty: true,
        });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_pageNotExist).toBeNull();
        expect(_pageT?.descendantCount).toBe(0);
      });
    });

    describe('Changing grant to GRANT_RESTRICTED', () => {
      it('successfully change to GRANT_RESTRICTED from GRANT_OWNER', async () => {
        const path = '/mup40';
        const _page = await Page.findOne({
          path,
          grant: Page.GRANT_OWNER,
          grantedUsers: [dummyUser1._id],
        });
        expect(_page).toBeTruthy();

        await updatePage(
          _page,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          { grant: Page.GRANT_RESTRICTED },
        );

        const page = await Page.findOne({ path });
        expect(page).toBeTruthy();
        expect(page?.grant).toBe(Page.GRANT_RESTRICTED);
        expect(page?.grantedUsers).toStrictEqual([]);
      });
    });

    describe('Changing grant from RESTRICTED to PUBLIC of', () => {
      it('a page will create ancestors if they do not exist', async () => {
        const pathT = '/mup16_top';
        const path1 = '/mup16_top/mup9_pub';
        const path2 = '/mup16_top/mup9_pub/mup10_pub';
        const path3 = '/mup16_top/mup9_pub/mup10_pub/mup11_awl';
        const top = await Page.findOne({ path: pathT });
        const page1 = await Page.findOne({ path: path1 });
        const page2 = await Page.findOne({ path: path2 });
        const page3 = await Page.findOne({
          path: path3,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(top).toBeTruthy();
        expect(page3).toBeTruthy();
        expect(page1).toBeNull();
        expect(page2).toBeNull();

        await updatePage(
          page3,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          { grant: Page.GRANT_PUBLIC },
        );

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, isEmpty: true });
        const _page2 = await Page.findOne({ path: path2, isEmpty: true });
        const _page3 = await Page.findOne({
          path: path3,
          grant: Page.GRANT_PUBLIC,
        });
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_page1?.parent).toStrictEqual(top?._id);
        expect(_page2?.parent).toStrictEqual(_page1?._id);
        expect(_page3?.parent).toStrictEqual(_page2?._id);
        expect(_pageT?.descendantCount).toBe(1);
      });
      it('a page will replace an empty page with the same path if any', async () => {
        const pathT = '/mup17_top';
        const path1 = '/mup17_top/mup12_emp';
        const path2 = '/mup17_top/mup12_emp/mup18_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 1 });
        const page1 = await Page.findOne({ path: path1, isEmpty: true });
        const page2 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
          isEmpty: false,
        });
        const page3 = await Page.findOne({ path: path2 });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();
        expect(page3).toBeTruthy();

        await updatePage(
          page2,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          { grant: Page.GRANT_PUBLIC },
        );

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, isEmpty: true }); // should be replaced
        const _page2 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const _page3 = await Page.findOne({ path: path2 });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeNull();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_page2?.grant).toBe(Page.GRANT_PUBLIC);
        expect(_page2?.parent).toStrictEqual(_pageT?._id);
        expect(_page3?.parent).toStrictEqual(_page2?._id);
        expect(_pageT?.descendantCount).toBe(2);
      });
    });

    describe('Changing grant to GRANT_OWNER(onlyme)', () => {
      it('successfully change to GRANT_OWNER from GRANT_PUBLIC', async () => {
        const path = '/mup19';
        const _page = await Page.findOne({ path, grant: Page.GRANT_PUBLIC });
        expect(_page).toBeTruthy();

        await updatePage(
          _page,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          { grant: Page.GRANT_OWNER },
        );

        const page = await Page.findOne({ path });
        expect(page?.grant).toBe(Page.GRANT_OWNER);
        expect(page?.grantedUsers).toStrictEqual([dummyUser1._id]);
      });
      it('successfully change to GRANT_OWNER from GRANT_USER_GROUP', async () => {
        const path = '/mup20';
        const _page = await Page.findOne({
          path,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: userGroupIdPModelA } },
        });
        expect(_page).toBeTruthy();

        await updatePage(
          _page,
          'newRevisionBody',
          'oldRevisionBody',
          pModelUser1,
          { grant: Page.GRANT_OWNER },
        );

        const page = await Page.findOne({ path });
        expect(page?.grant).toBe(Page.GRANT_OWNER);
        expect(page?.grantedUsers).toStrictEqual([pModelUser1._id]);
        expect(page?.grantedGroups?.length).toBe(0);
      });
      it('successfully change to GRANT_OWNER from GRANT_RESTRICTED', async () => {
        const path = '/mup21';
        const _page = await Page.findOne({
          path,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(_page).toBeTruthy();

        await updatePage(
          _page,
          'newRevisionBody',
          'oldRevisionBody',
          dummyUser1,
          { grant: Page.GRANT_OWNER },
        );

        const page = await Page.findOne({ path });
        expect(page?.grant).toBe(Page.GRANT_OWNER);
        expect(page?.grantedUsers).toStrictEqual([dummyUser1._id]);
      });
      it('Failed to change to GRANT_OWNER if one of the ancestors is GRANT_USER_GROUP page', async () => {
        const path1 = '/mup22';
        const path2 = '/mup22/mup23';
        const _page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const _page2 = await Page.findOne({
          path: path2,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: userGroupIdPModelA } },
        });
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();

        await expect(
          updatePage(_page1, 'newRevisionBody', 'oldRevisionBody', dummyUser1, {
            grant: Page.GRANT_OWNER,
          }),
        ).rejects.toThrow(
          new Error(
            'The selected grant or grantedGroup is not assignable to this page.',
          ),
        );

        const page1 = await Page.findOne({ path1 });
        expect(page1).toBeTruthy();
        expect(page1?.grant).toBe(Page.GRANT_PUBLIC);
        expect(page1?.grantedUsers).not.toStrictEqual([dummyUser1._id]);
      });
    });
    describe('Changing grant to GRANT_USER_GROUP', () => {
      describe('update grant of a page under a page with GRANT_PUBLIC', () => {
        it('successfully change to GRANT_USER_GROUP from GRANT_PUBLIC if parent page is GRANT_PUBLIC', async () => {
          // path
          const path1 = '/mup24_pub';
          const path2 = '/mup24_pub/mup25_pub';
          // page
          const _page1 = await Page.findOne({
            path: path1,
            grant: Page.GRANT_PUBLIC,
          }); // out of update scope
          const _page2 = await Page.findOne({
            path: path2,
            grant: Page.GRANT_PUBLIC,
            parent: _page1?._id,
          }); // update target
          expect(_page1).toBeTruthy();
          expect(_page2).toBeTruthy();

          const newGrantedGroups = [
            { item: userGroupIdPModelA, type: GroupType.userGroup },
            {
              item: externalUserGroupIdPModelA,
              type: GroupType.externalUserGroup,
            },
          ];

          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: newGrantedGroups,
          };
          const updatedPage = await updatePage(
            _page2,
            'new',
            'old',
            pModelUser1,
            options,
          ); // from GRANT_PUBLIC to GRANT_USER_GROUP(userGroupIdPModelA)

          const page1 = await Page.findById(_page1?._id);
          const page2 = await Page.findById(_page2?._id);
          expect(page1).toBeTruthy();
          expect(page2).toBeTruthy();
          expect(updatedPage).toBeTruthy();
          expect(updatedPage._id).toStrictEqual(page2?._id);

          // check page2 grant and group
          expect(page2?.grant).toBe(Page.GRANT_USER_GROUP);
          expect(normalizeGrantedGroups(page2?.grantedGroups)).toStrictEqual(
            newGrantedGroups,
          );
        });

        it('successfully change to GRANT_USER_GROUP from GRANT_RESTRICTED if parent page is GRANT_PUBLIC', async () => {
          // path
          const _path1 = '/mup26_awl';
          // page
          const _page1 = await Page.findOne({
            path: _path1,
            grant: Page.GRANT_RESTRICTED,
          });
          expect(_page1).toBeTruthy();

          const newGrantedGroups = [
            { item: userGroupIdPModelA, type: GroupType.userGroup },
            {
              item: externalUserGroupIdPModelA,
              type: GroupType.externalUserGroup,
            },
          ];

          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: newGrantedGroups,
          };
          const updatedPage = await updatePage(
            _page1,
            'new',
            'old',
            pModelUser1,
            options,
          ); // from GRANT_RESTRICTED to GRANT_USER_GROUP(userGroupIdPModelA)

          const page1 = await Page.findById(_page1?._id);
          expect(page1).toBeTruthy();
          expect(updatedPage).toBeTruthy();
          expect(updatedPage._id).toStrictEqual(page1?._id);

          // updated page
          expect(page1?.grant).toBe(Page.GRANT_USER_GROUP);
          expect(normalizeGrantedGroups(page1?.grantedGroups)).toStrictEqual(
            newGrantedGroups,
          );

          // parent's grant check
          const parent = await Page.findById(page1?.parent);
          expect(parent?.grant).toBe(Page.GRANT_PUBLIC);
        });

        it('successfully change to GRANT_USER_GROUP from GRANT_OWNER if parent page is GRANT_PUBLIC', async () => {
          // path
          const path1 = '/mup27_pub';
          const path2 = '/mup27_pub/mup28_owner';
          // page
          const _page1 = await Page.findOne({
            path: path1,
            grant: Page.GRANT_PUBLIC,
          }); // out of update scope
          const _page2 = await Page.findOne({
            path: path2,
            grant: Page.GRANT_OWNER,
            grantedUsers: [pModelUser1],
            parent: _page1?._id,
          }); // update target
          expect(_page1).toBeTruthy();
          expect(_page2).toBeTruthy();

          const newGrantedGroups = [
            { item: userGroupIdPModelA, type: GroupType.userGroup },
            {
              item: externalUserGroupIdPModelA,
              type: GroupType.externalUserGroup,
            },
          ];

          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: newGrantedGroups,
          };
          const updatedPage = await updatePage(
            _page2,
            'new',
            'old',
            pModelUser1,
            options,
          ); // from GRANT_OWNER to GRANT_USER_GROUP(userGroupIdPModelA)

          const page1 = await Page.findById(_page1?._id);
          const page2 = await Page.findById(_page2?._id);
          expect(page1).toBeTruthy();
          expect(page2).toBeTruthy();
          expect(updatedPage).toBeTruthy();
          expect(updatedPage._id).toStrictEqual(page2?._id);

          // grant check
          expect(page2?.grant).toBe(Page.GRANT_USER_GROUP);
          expect(normalizeGrantedGroups(page2?.grantedGroups)).toStrictEqual(
            newGrantedGroups,
          );
          expect(page2?.grantedUsers?.length).toBe(0);
        });
      });
      describe('update grant of a page under a page with GRANT_USER_GROUP', () => {
        it('successfully change to GRANT_USER_GROUP if the group to set is the child or descendant of the parent page group', async () => {
          // path
          const _path1 = '/mup29_A';
          const _path2 = '/mup29_A/mup30_owner';
          // page
          const _page1 = await Page.findOne({
            path: _path1,
            grant: Page.GRANT_USER_GROUP,
            grantedGroups: { $elemMatch: { item: userGroupIdPModelA } },
          }); // out of update scope
          const _page2 = await Page.findOne({
            // update target
            path: _path2,
            grant: Page.GRANT_OWNER,
            grantedUsers: [pModelUser1],
            parent: _page1?._id,
          });
          expect(_page1).toBeTruthy();
          expect(_page2).toBeTruthy();

          // First round
          // Group relation(parent -> child): userGroupIdPModelA -> userGroupIdPModelB -> userGroupIdPModelC
          const newGrantedGroups = [
            { item: userGroupIdPModelB, type: GroupType.userGroup },
            {
              item: externalUserGroupIdPModelB,
              type: GroupType.externalUserGroup,
            },
          ];
          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: newGrantedGroups,
          };
          const updatedPage = await updatePage(
            _page2,
            'new',
            'old',
            pModelUser3,
            options,
          ); // from GRANT_OWNER to GRANT_USER_GROUP(userGroupIdPModelB)

          const page1 = await Page.findById(_page1?._id);
          const page2 = await Page.findById(_page2?._id);
          expect(page1).toBeTruthy();
          expect(page2).toBeTruthy();
          expect(updatedPage).toBeTruthy();
          expect(updatedPage._id).toStrictEqual(page2?._id);

          expect(page2?.grant).toBe(Page.GRANT_USER_GROUP);
          expect(normalizeGrantedGroups(page2?.grantedGroups)).toStrictEqual(
            newGrantedGroups,
          );
          expect(page2?.grantedUsers?.length).toBe(0);

          // Second round
          // Update group to groupC which is a grandchild from pageA's point of view
          const secondRoundNewGrantedGroups = [
            { item: userGroupIdPModelC, type: GroupType.userGroup },
            {
              item: externalUserGroupIdPModelC,
              type: GroupType.externalUserGroup,
            },
          ];
          const secondRoundOptions = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: secondRoundNewGrantedGroups,
          }; // from GRANT_USER_GROUP(userGroupIdPModelB) to GRANT_USER_GROUP(userGroupIdPModelC)
          // undo grantedGroups populate to prevent Page.hydrate error
          _page2?.grantedGroups?.forEach((group) => {
            // biome-ignore lint/suspicious/noExplicitAny: <explanation>
            (group as any).item = (group.item as any)._id;
          });
          const secondRoundUpdatedPage = await updatePage(
            _page2,
            'new',
            'new',
            pModelUser3,
            secondRoundOptions,
          );

          expect(secondRoundUpdatedPage).toBeTruthy();
          expect(secondRoundUpdatedPage.grant).toBe(Page.GRANT_USER_GROUP);
          expect(
            normalizeGrantedGroups(secondRoundUpdatedPage.grantedGroups),
          ).toStrictEqual(secondRoundNewGrantedGroups);
        });
        it('Fail to change to GRANT_USER_GROUP if the group to set is NOT the child or descendant of the parent page group', async () => {
          // path
          const _path1 = '/mup31_A';
          const _path2 = '/mup31_A/mup32_owner';
          // page
          const _page1 = await Page.findOne({
            path: _path1,
            grant: Page.GRANT_USER_GROUP,
            grantedGroups: { $elemMatch: { item: userGroupIdPModelA } },
          });
          const _page2 = await Page.findOne({
            // update target
            path: _path2,
            grant: Page.GRANT_OWNER,
            grantedUsers: [pModelUser1._id],
            parent: _page1?._id,
          });
          expect(_page1).toBeTruthy();
          expect(_page2).toBeTruthy();

          // group
          const _groupIsolated = await UserGroup.findById(
            userGroupIdPModelIsolate,
          );
          expect(_groupIsolated).toBeTruthy();
          // group parent check
          expect(_groupIsolated?.parent).toBeUndefined(); // should have no parent

          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: [
              { item: userGroupIdPModelIsolate, type: GroupType.userGroup },
              {
                item: externalUserGroupIdPModelIsolate,
                type: GroupType.externalUserGroup,
              },
            ],
          };
          await expect(updatePage(_page2, 'new', 'old', pModelUser1, options)) // from GRANT_OWNER to GRANT_USER_GROUP(userGroupIdPModelIsolate)
            .rejects.toThrow(
              new Error(
                'The selected grant or grantedGroup is not assignable to this page.',
              ),
            );

          const page1 = await Page.findById(_page1?._id);
          const page2 = await Page.findById(_page2?._id);
          expect(page1).toBeTruthy();
          expect(page1).toBeTruthy();

          expect(page2?.grant).toBe(Page.GRANT_OWNER); // should be the same before the update
          expect(page2?.grantedUsers).toStrictEqual([pModelUser1._id]); // should be the same before the update
          expect(page2?.grantedGroups?.length).toBe(0); // no group should be set
        });
        it('Fail to change to GRANT_USER_GROUP if the group to set is an ancestor of the parent page group', async () => {
          // path
          const _path1 = '/mup33_C';
          const _path2 = '/mup33_C/mup34_owner';
          // page
          const _page1 = await Page.findOne({
            path: _path1,
            grant: Page.GRANT_USER_GROUP,
            grantedGroups: { $elemMatch: { item: userGroupIdPModelC } },
          }); // groupC
          const _page2 = await Page.findOne({
            // update target
            path: _path2,
            grant: Page.GRANT_OWNER,
            grantedUsers: [pModelUser3],
            parent: _page1?._id,
          });
          expect(_page1).toBeTruthy();
          expect(_page2).toBeTruthy();

          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: [
              { item: userGroupIdPModelA, type: GroupType.userGroup },
              {
                item: externalUserGroupIdPModelA,
                type: GroupType.externalUserGroup,
              },
            ],
          };

          // Group relation(parent -> child): userGroupIdPModelA -> userGroupIdPModelB -> userGroupIdPModelC
          // this should fail because the groupC is a descendant of groupA
          await expect(updatePage(_page2, 'new', 'old', pModelUser3, options)) // from GRANT_OWNER to GRANT_USER_GROUP(userGroupIdPModelA)
            .rejects.toThrow(
              new Error(
                'The selected grant or grantedGroup is not assignable to this page.',
              ),
            );

          const page1 = await Page.findById(_page1?._id);
          const page2 = await Page.findById(_page2?._id);
          expect(page1).toBeTruthy();
          expect(page2).toBeTruthy();

          expect(page2?.grant).toBe(Page.GRANT_OWNER); // should be the same before the update
          expect(page2?.grantedUsers).toStrictEqual([pModelUser3._id]); // should be the same before the update
          expect(page2?.grantedGroups?.length).toBe(0); // no group should be set
        });
      });
      describe('update grant of a page under a page with GRANT_OWNER', () => {
        it('Fail to change from GRNAT_OWNER', async () => {
          // path
          const path1 = '/mup35_owner';
          const path2 = '/mup35_owner/mup36_owner';
          // page
          const _page1 = await Page.findOne({
            path: path1,
            grant: Page.GRANT_OWNER,
            grantedUsers: [pModelUser1],
          });
          const _page2 = await Page.findOne({
            // update target
            path: path2,
            grant: Page.GRANT_OWNER,
            grantedUsers: [pModelUser1],
            parent: _page1?._id,
          });
          expect(_page1).toBeTruthy();
          expect(_page2).toBeTruthy();

          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: [
              { item: userGroupIdPModelA, type: GroupType.userGroup },
            ],
          };
          await expect(updatePage(_page2, 'new', 'old', pModelUser1, options)) // from GRANT_OWNER to GRANT_USER_GROUP(userGroupIdPModelA)
            .rejects.toThrow(
              new Error(
                'The selected grant or grantedGroup is not assignable to this page.',
              ),
            );

          const page1 = await Page.findById(_page1?.id);
          const page2 = await Page.findById(_page2?.id);
          expect(page1).toBeTruthy();
          expect(page2).toBeTruthy();
          expect(page2?.grant).toBe(Page.GRANT_OWNER); // should be the same before the update
          expect(page2?.grantedUsers).toStrictEqual([pModelUser1._id]); // should be the same before the update
          expect(page2?.grantedGroups?.length).toBe(0); // no group should be set
        });
      });
      describe('update grant of a page from GRANT_USER_GROUP to GRANT_USER_GROUP', () => {
        it('successfully change the granted groups, with the previous groups wich user is not related to remaining', async () => {
          // path
          const path = '/with_multiple_individual_granted_groups';
          // page
          const _page = await Page.findOne({
            path,
            grant: Page.GRANT_USER_GROUP,
          });
          expect(_page).toBeTruthy();

          const newUserRelatedGrantedGroups = [
            { item: userGroupIdPModelA, type: GroupType.userGroup },
            {
              item: externalUserGroupIdPModelA,
              type: GroupType.externalUserGroup,
            },
          ];

          const options = {
            grant: Page.GRANT_USER_GROUP,
            userRelatedGrantUserGroupIds: newUserRelatedGrantedGroups,
          };
          const updatedPage = await updatePage(
            _page,
            'new',
            'old',
            pModelUser1,
            options,
          ); // from GRANT_PUBLIC to GRANT_USER_GROUP(userGroupIdPModelA)

          const page = await Page.findById(_page?._id);
          expect(page).toBeTruthy();
          expect(updatedPage).toBeTruthy();
          expect(updatedPage._id).toStrictEqual(page?._id);

          // check page grant and group
          expect(page?.grant).toBe(Page.GRANT_USER_GROUP);
          expect(normalizeGrantedGroups(page?.grantedGroups)).toEqual(
            expect.arrayContaining([
              ...newUserRelatedGrantedGroups,
              // userB group remains, although options does not include it
              { item: userGroupIdPModelB, type: GroupType.userGroup },
            ]),
          );
          expect(normalizeGrantedGroups(page?.grantedGroups)?.length).toBe(3);
        });
      });
    });
  });

  // see: https://dev.growi.org/635a314eac6bcd85cbf359fc about the specification
  describe('updatePage with overwriteScopesOfDescendants true', () => {
    it('(case 1) it should update all granted descendant pages when update grant is GRANT_PUBLIC', async () => {
      const upodPagegAB = await Page.findOne({ path: '/gAB_upod_1' });
      const upodPagegB = await Page.findOne({ path: '/gAB_upod_1/gB_upod_1' });
      const upodPageonlyB = await Page.findOne({
        path: '/gAB_upod_1/onlyB_upod_1',
      });
      const upodPagegAgB = await Page.findOne({
        path: '/gAB_upod_1/gA_gB_upod_1',
      });

      expect(upodPagegAB).not.toBeNull();
      expect(upodPagegB).not.toBeNull();
      expect(upodPageonlyB).not.toBeNull();
      expect(upodPagegAgB).not.toBeNull();

      expect(upodPagegAB?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegB?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPageonlyB?.grant).toBe(PageGrant.GRANT_OWNER);
      expect(upodPagegAgB?.grant).toBe(PageGrant.GRANT_USER_GROUP);

      // Update
      const options = {
        grant: PageGrant.GRANT_PUBLIC,
        overwriteScopesOfDescendants: true,
      };
      const updatedPage = await updatePage(
        upodPagegAB,
        'newRevisionBody',
        'oldRevisionBody',
        upodUserA,
        options,
      );

      const upodPagegBUpdated = await Page.findOne({
        path: '/gAB_upod_1/gB_upod_1',
      });
      const upodPageonlyBUpdated = await Page.findOne({
        path: '/gAB_upod_1/onlyB_upod_1',
      });
      const upodPagegAgBUpdated = await Page.findOne({
        path: '/gAB_upod_1/gA_gB_upod_1',
      });

      // Changed
      const newGrant = PageGrant.GRANT_PUBLIC;
      expect(updatedPage.grant).toBe(newGrant);
      // Not changed
      expect(upodPagegBUpdated?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegBUpdated?.grantedGroups).toStrictEqual(
        upodPagegB?.grantedGroups,
      );
      expect(upodPageonlyBUpdated?.grant).toBe(PageGrant.GRANT_OWNER);
      expect(upodPageonlyBUpdated?.grantedUsers).toStrictEqual(
        upodPageonlyB?.grantedUsers,
      );
      expect(upodPagegAgBUpdated?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegAgBUpdated?.grantedGroups).toStrictEqual(
        upodPagegAgB?.grantedGroups,
      );
    });
    it('(case 2) it should update all granted descendant pages when all descendant pages are granted to the operator', async () => {
      const upodPagePublic = await Page.findOne({ path: '/public_upod_2' });
      const upodPagegA = await Page.findOne({
        path: '/public_upod_2/gA_upod_2',
      });
      const upodPagegAIsolated = await Page.findOne({
        path: '/public_upod_2/gAIsolated_upod_2',
      });
      const upodPageonlyA = await Page.findOne({
        path: '/public_upod_2/onlyA_upod_2',
      });

      expect(upodPagePublic).not.toBeNull();
      expect(upodPagegA).not.toBeNull();
      expect(upodPagegAIsolated).not.toBeNull();
      expect(upodPageonlyA).not.toBeNull();

      expect(upodPagePublic?.grant).toBe(PageGrant.GRANT_PUBLIC);
      expect(upodPagegA?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegAIsolated?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPageonlyA?.grant).toBe(PageGrant.GRANT_OWNER);

      // Update
      const options = {
        grant: PageGrant.GRANT_OWNER,
        overwriteScopesOfDescendants: true,
      };
      const updatedPage = await updatePage(
        upodPagePublic,
        'newRevisionBody',
        'oldRevisionBody',
        upodUserA,
        options,
      );

      const upodPagegAUpdated = await Page.findOne({
        path: '/public_upod_2/gA_upod_2',
      });
      const upodPagegAIsolatedUpdated = await Page.findOne({
        path: '/public_upod_2/gAIsolated_upod_2',
      });
      const upodPageonlyAUpdated = await Page.findOne({
        path: '/public_upod_2/onlyA_upod_2',
      });

      // Changed
      const newGrant = PageGrant.GRANT_OWNER;
      const newGrantedUsers = [upodUserA._id];
      expect(updatedPage.grant).toBe(newGrant);
      expect(updatedPage.grantedUsers).toStrictEqual(newGrantedUsers);
      expect(upodPagegAUpdated?.grant).toBe(newGrant);
      expect(upodPagegAUpdated?.grantedUsers).toStrictEqual(newGrantedUsers);
      expect(upodPagegAIsolatedUpdated?.grant).toBe(newGrant);
      expect(upodPagegAIsolatedUpdated?.grantedUsers).toStrictEqual(
        newGrantedUsers,
      );
      expect(upodPageonlyAUpdated?.grant).toBe(newGrant);
      expect(upodPageonlyAUpdated?.grantedUsers).toStrictEqual(newGrantedUsers);
    });
    it(`(case 3) it should update all granted descendant pages when update grant is GRANT_USER_GROUP
    , all user groups of descendants are the children or itself of the update user group
    , and all users of descendants belong to the update user group`, async () => {
      const upodPagePublic = await Page.findOne({ path: '/public_upod_3' });
      const upodPagegAB = await Page.findOne({
        path: '/public_upod_3/gAB_upod_3',
      });
      const upodPagegAgB = await Page.findOne({
        path: '/public_upod_3/gA_gB_upod_3',
      });
      const upodPagegB = await Page.findOne({
        path: '/public_upod_3/gB_upod_3',
      });
      const upodPageonlyB = await Page.findOne({
        path: '/public_upod_3/onlyB_upod_3',
      });

      expect(upodPagePublic).not.toBeNull();
      expect(upodPagegAB).not.toBeNull();
      expect(upodPagegAgB).not.toBeNull();
      expect(upodPagegB).not.toBeNull();
      expect(upodPageonlyB).not.toBeNull();

      expect(upodPagePublic?.grant).toBe(PageGrant.GRANT_PUBLIC);
      expect(upodPagegAB?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegAgB?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegB?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPageonlyB?.grant).toBe(PageGrant.GRANT_OWNER);

      // Update
      const options = {
        grant: PageGrant.GRANT_USER_GROUP,
        userRelatedGrantUserGroupIds: [
          { item: upodUserGroupIdAB, type: GroupType.userGroup },
          {
            item: upodExternalUserGroupIdAB,
            type: GroupType.externalUserGroup,
          },
        ],
        overwriteScopesOfDescendants: true,
      };
      const updatedPage = await updatePage(
        upodPagePublic,
        'newRevisionBody',
        'oldRevisionBody',
        upodUserA,
        options,
      );

      const upodPagegABUpdated = await Page.findOne({
        path: '/public_upod_3/gAB_upod_3',
      });
      const upodPagegAgBUpdated = await Page.findOne({
        path: '/public_upod_3/gA_gB_upod_3',
      });
      const upodPagegBUpdated = await Page.findOne({
        path: '/public_upod_3/gB_upod_3',
      });
      const upodPageonlyBUpdated = await Page.findOne({
        path: '/public_upod_3/onlyB_upod_3',
      });

      // Changed
      const newGrant = PageGrant.GRANT_USER_GROUP;
      const newGrantedGroups = [
        { item: upodUserGroupIdAB, type: GroupType.userGroup },
        { item: upodExternalUserGroupIdAB, type: GroupType.externalUserGroup },
      ];
      expect(updatedPage.grant).toBe(newGrant);
      expect(normalizeGrantedGroups(updatedPage.grantedGroups)).toStrictEqual(
        newGrantedGroups,
      );
      expect(upodPagegABUpdated?.grant).toBe(newGrant);
      expect(
        normalizeGrantedGroups(upodPagegABUpdated?.grantedGroups),
      ).toStrictEqual(newGrantedGroups);
      expect(upodPagegAgBUpdated?.grant).toBe(newGrant);
      // For multi group granted pages, the grant update will only add/remove groups that the user belongs to,
      // and groups that the user doesn't belong to will stay as it was before the update.
      expect(
        normalizeGrantedGroups(upodPagegAgBUpdated?.grantedGroups),
      ).toEqual(
        expect.arrayContaining([
          ...newGrantedGroups,
          { item: upodUserGroupIdB, type: GroupType.userGroup },
          { item: upodExternalUserGroupIdB, type: GroupType.externalUserGroup },
        ]),
      );
      expect(
        normalizeGrantedGroups(upodPagegAgBUpdated?.grantedGroups)?.length,
      ).toBe(4);

      // Not changed
      expect(upodPagegBUpdated?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegBUpdated?.grantedGroups).toStrictEqual(
        upodPagegB?.grantedGroups,
      );
      expect(upodPageonlyBUpdated?.grant).toBe(PageGrant.GRANT_OWNER);
      expect(upodPageonlyBUpdated?.grantedUsers).toStrictEqual(
        upodPageonlyB?.grantedUsers,
      );
    });
    it(`(case 4) it should throw when some of descendants is not granted
    , update grant is GRANT_USER_GROUP
    , and some of user groups of descendants are not children or itself of the update user group`, async () => {
      const upodPagePublic = await Page.findOne({ path: '/public_upod_4' });
      const upodPagegA = await Page.findOne({
        path: '/public_upod_4/gA_upod_4',
      });
      const upodPagegC = await Page.findOne({
        path: '/public_upod_4/gC_upod_4',
      });

      expect(upodPagePublic).not.toBeNull();
      expect(upodPagegA).not.toBeNull();
      expect(upodPagegC).not.toBeNull();

      expect(upodPagePublic?.grant).toBe(PageGrant.GRANT_PUBLIC);
      expect(upodPagegA?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPagegC?.grant).toBe(PageGrant.GRANT_USER_GROUP);

      // Update
      const options = {
        grant: PageGrant.GRANT_USER_GROUP,
        userRelatedGrantUserGroupIds: [
          { item: upodUserGroupIdAB, type: GroupType.userGroup },
          {
            item: upodExternalUserGroupIdAB,
            type: GroupType.externalUserGroup,
          },
        ],
        overwriteScopesOfDescendants: true,
      };
      const updatedPagePromise = updatePage(
        upodPagePublic,
        'newRevisionBody',
        'oldRevisionBody',
        upodUserA,
        options,
      );

      await expect(updatedPagePromise).rejects.toThrowError();
    });
    it(`(case 5) it should throw when some of descendants is not granted
    , update grant is GRANT_USER_GROUP
    , and some of users of descendants does NOT belong to the update user group`, async () => {
      const upodPagePublic = await Page.findOne({ path: '/public_upod_5' });
      const upodPagegA = await Page.findOne({
        path: '/public_upod_5/gA_upod_5',
      });
      const upodPageonlyC = await Page.findOne({
        path: '/public_upod_5/onlyC_upod_5',
      });

      expect(upodPagePublic).not.toBeNull();
      expect(upodPagegA).not.toBeNull();
      expect(upodPageonlyC).not.toBeNull();

      expect(upodPagePublic?.grant).toBe(PageGrant.GRANT_PUBLIC);
      expect(upodPagegA?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(upodPageonlyC?.grant).toBe(PageGrant.GRANT_OWNER);

      // Update
      const options = {
        grant: PageGrant.GRANT_USER_GROUP,
        userRelatedGrantUserGroupIds: [
          { item: upodUserGroupIdAB, type: GroupType.userGroup },
          {
            item: upodExternalUserGroupIdAB,
            type: GroupType.externalUserGroup,
          },
        ],
        overwriteScopesOfDescendants: true,
      };
      const updatedPagePromise = updatePage(
        upodPagePublic,
        'newRevisionBody',
        'oldRevisionBody',
        upodUserA,
        options,
      );

      await expect(updatedPagePromise).rejects.toThrowError();
    });
    it('(case 6) it should throw when some of descendants is not granted and update grant is GRANT_OWNER', async () => {
      const upodPagePublic = await Page.findOne({ path: '/public_upod_6' });
      const upodPageonlyC = await Page.findOne({
        path: '/public_upod_6/onlyC_upod_6',
      });

      expect(upodPagePublic).not.toBeNull();
      expect(upodPageonlyC).not.toBeNull();

      expect(upodPagePublic?.grant).toBe(PageGrant.GRANT_PUBLIC);
      expect(upodPageonlyC?.grant).toBe(PageGrant.GRANT_OWNER);

      // Update
      const options = {
        grant: PageGrant.GRANT_USER_GROUP,
        userRelatedGrantUserGroupIds: [
          { item: upodUserGroupIdAB, type: GroupType.userGroup },
          {
            item: upodExternalUserGroupIdAB,
            type: GroupType.externalUserGroup,
          },
        ],
        overwriteScopesOfDescendants: true,
      };
      const updatedPagePromise = updatePage(
        upodPagePublic,
        'newRevisionBody',
        'oldRevisionBody',
        upodUserA,
        options,
      );

      await expect(updatedPagePromise).rejects.toThrowError();
    });
  });
});
