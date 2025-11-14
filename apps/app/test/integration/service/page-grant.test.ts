import { GroupType, type IPage, PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { ExternalGroupProviderType } from '../../../src/features/external-user-group/interfaces/external-user-group';
import ExternalUserGroup, {
  type ExternalUserGroupDocument,
} from '../../../src/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '../../../src/features/external-user-group/server/models/external-user-group-relation';
import { UserGroupPageGrantStatus } from '../../../src/interfaces/page';
import type Crowi from '../../../src/server/crowi';
import type { PageDocument, PageModel } from '../../../src/server/models/page';
import UserGroup, {
  type UserGroupDocument,
} from '../../../src/server/models/user-group';
import UserGroupRelation from '../../../src/server/models/user-group-relation';
import type { IPageGrantService } from '../../../src/server/service/page-grant';
import { getInstance } from '../setup-crowi';

/*
 * There are 3 grant types to test.
 * GRANT_PUBLIC, GRANT_OWNER, GRANT_USER_GROUP
 */
describe('PageGrantService', () => {
  /*
   * models
   */
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let User;
  let Page: PageModel;

  /*
   * global instances
   */
  let crowi: Crowi;
  let pageGrantService: IPageGrantService;

  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let user1;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let user2;

  let groupParent: UserGroupDocument;
  let groupChild: UserGroupDocument;
  let differentTreeGroup: UserGroupDocument;

  let externalGroupParent: ExternalUserGroupDocument;
  let externalGroupChild: ExternalUserGroupDocument;

  const userGroupIdParent = new mongoose.Types.ObjectId();
  const externalUserGroupIdParent = new mongoose.Types.ObjectId();

  let rootPage: PageDocument;
  let rootPublicPage: PageDocument;
  let rootOnlyMePage: PageDocument;
  let rootOnlyInsideTheGroup: PageDocument;
  let emptyPage1: PageDocument;
  let emptyPage2: PageDocument;
  let emptyPage3: PageDocument;
  const emptyPagePath1 = '/E1';
  const emptyPagePath2 = '/E2';
  const emptyPagePath3 = '/E3';

  let multipleGroupTreesAndUsersPage: PageDocument;

  const pageRootPublicPath = '/Public';
  const pageRootGroupParentPath = '/GroupParent';
  const pageMultipleGroupTreesAndUsersPath = '/MultipleGroupTreesAndUsers';

  const v4PageRootOnlyMePagePath = '/v4OnlyMe';
  const v4PageRootAnyoneWithTheLinkPagePath = '/v4AnyoneWithTheLink';
  const v4PageRootOnlyInsideTheGroupPagePath = '/v4OnlyInsideTheGroup';

  const pagePublicOnlyMePath = `${pageRootPublicPath}/OnlyMe`;
  const pagePublicAnyoneWithTheLinkPath = `${pageRootPublicPath}/AnyoneWithTheLink`;
  const pagePublicOnlyInsideTheGroupPath = `${pageRootPublicPath}/OnlyInsideTheGroup`;

  const pageOnlyMePublicPath = `${v4PageRootOnlyMePagePath}/Public`;
  const pageOnlyMeAnyoneWithTheLinkPath = `${v4PageRootOnlyMePagePath}/AnyoneWithTheLink`;
  const pageOnlyMeOnlyInsideTheGroupPath = `${v4PageRootOnlyMePagePath}/OnlyInsideTheGroup`;

  const pageOnlyInsideTheGroupPublicPath = `${v4PageRootOnlyInsideTheGroupPagePath}/Public`;
  const pageOnlyInsideTheGroupOnlyMePath = `${v4PageRootOnlyInsideTheGroupPagePath}/OnlyMe`;
  const pageOnlyInsideTheGroupAnyoneWithTheLinkPath = `${v4PageRootOnlyInsideTheGroupPagePath}/AnyoneWithTheLink`;
  const pageE1PublicPath = '/E1/Public';
  const pageE2User1Path = '/E2/User1';
  const pageE3GroupParentPath = '/E3/GroupParent';
  const pageE3GroupChildPath = '/E3/GroupChild';
  const pageE3User1Path = '/E3/User1';

  // getPageGroupGrantData test data
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let user3;
  let groupGrantDataTestChildPagePath: string;
  let groupGrantDataTestParentUserGroupId: mongoose.Types.ObjectId;
  let groupGrantDataTestChildUserGroupId: mongoose.Types.ObjectId;
  let groupGrantDataTestExternalUserGroupId: mongoose.Types.ObjectId;
  let groupGrantDataTestExternalUserGroupId2: mongoose.Types.ObjectId;

  const createDocumentsToTestIsGrantNormalized = async () => {
    // Users
    await User.insertMany([
      { name: 'User1', username: 'User1', email: 'user1@example.com' },
      { name: 'User2', username: 'User2', email: 'user2@example.com' },
    ]);

    user1 = await User.findOne({ username: 'User1' });
    user2 = await User.findOne({ username: 'User2' });

    await UserGroup.insertMany([
      {
        _id: userGroupIdParent,
        name: 'GroupParent',
        parent: null,
      },
      {
        name: 'GroupChild',
        parent: userGroupIdParent,
      },
      {
        name: 'DifferentTreeGroup',
        parent: null,
      },
    ]);

    groupParent = (await UserGroup.findOne({ name: 'GroupParent' }))!;
    groupChild = (await UserGroup.findOne({ name: 'GroupChild' }))!;
    differentTreeGroup = (await UserGroup.findOne({
      name: 'DifferentTreeGroup',
    }))!;

    // UserGroupRelations
    await UserGroupRelation.insertMany([
      {
        relatedGroup: groupParent._id,
        relatedUser: user1._id,
      },
      {
        relatedGroup: groupParent._id,
        relatedUser: user2._id,
      },
      {
        relatedGroup: groupChild._id,
        relatedUser: user1._id,
      },
      {
        relatedGroup: differentTreeGroup._id,
        relatedUser: user1._id,
      },
    ]);

    await ExternalUserGroup.insertMany([
      {
        _id: externalUserGroupIdParent,
        name: 'ExternalGroupParent',
        externalId: 'ExternalGroupParent',
        provider: ExternalGroupProviderType.ldap,
        parent: null,
      },
      {
        name: 'ExternalGroupChild',
        externalId: 'ExternalGroupChild',
        provider: ExternalGroupProviderType.ldap,
        parent: externalUserGroupIdParent,
      },
    ]);

    externalGroupParent = await ExternalUserGroup.findOne({
      name: 'ExternalGroupParent',
    });
    externalGroupChild = await ExternalUserGroup.findOne({
      name: 'ExternalGroupChild',
    });

    await ExternalUserGroupRelation.insertMany([
      {
        relatedGroup: externalGroupParent._id,
        relatedUser: user1._id,
      },
      {
        relatedGroup: externalGroupParent._id,
        relatedUser: user2._id,
      },
      {
        relatedGroup: externalGroupChild._id,
        relatedUser: user1._id,
      },
    ]);

    // Root page (Depth: 0)
    rootPage = (await Page.findOne({ path: '/' }))!;

    // Empty pages (Depth: 1)
    await Page.insertMany([
      {
        path: emptyPagePath1,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
        parent: rootPage._id,
      },
      {
        path: emptyPagePath2,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
        parent: rootPage._id,
      },
      {
        path: emptyPagePath3,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
        parent: rootPage._id,
      },
      {
        path: pageRootPublicPath,
        grant: Page.GRANT_PUBLIC,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: null,
        grantedGroups: [],
        parent: rootPage._id,
      },
      {
        path: pageRootGroupParentPath,
        grant: Page.GRANT_USER_GROUP,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: null,
        grantedGroups: [
          { item: groupParent._id, type: GroupType.userGroup },
          { item: externalGroupParent._id, type: GroupType.externalUserGroup },
        ],
        parent: rootPage._id,
      },
      {
        path: pageMultipleGroupTreesAndUsersPath,
        grant: Page.GRANT_USER_GROUP,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: null,
        grantedGroups: [
          { item: groupParent._id, type: GroupType.userGroup },
          { item: differentTreeGroup._id, type: GroupType.userGroup },
        ],
        parent: null,
      },
    ]);

    multipleGroupTreesAndUsersPage = (await Page.findOne({
      path: pageMultipleGroupTreesAndUsersPath,
    }))!;

    await Page.insertMany([
      // Root Page
      {
        path: rootPage,
        grant: Page.GRANT_PUBLIC,
        parent: null,
      },
      // OnlyMe v4
      {
        path: v4PageRootOnlyMePagePath,
        grant: Page.GRANT_OWNER,
        grantedUsers: [user1._id],
        parent: null,
      },
      // AnyoneWithTheLink v4
      {
        path: v4PageRootAnyoneWithTheLinkPagePath,
        grant: Page.GRANT_RESTRICTED,
        parent: null,
      },
      // OnlyInsideTheGroup v4
      {
        path: v4PageRootOnlyInsideTheGroupPagePath,
        grant: Page.GRANT_USER_GROUP,
        parent: null,
        grantedGroups: [
          { item: groupParent._id, type: GroupType.userGroup },
          { item: externalGroupParent._id, type: GroupType.externalUserGroup },
        ],
      },
    ]);

    rootPublicPage = (await Page.findOne({ path: pageRootPublicPath }))!;
    rootOnlyMePage = (await Page.findOne({ path: v4PageRootOnlyMePagePath }))!;
    rootOnlyInsideTheGroup = (await Page.findOne({
      path: v4PageRootOnlyInsideTheGroupPagePath,
    }))!;

    // Leaf pages (Depth: 2)
    await Page.insertMany([
      /*
       * Parent is public
       */
      {
        path: pagePublicOnlyMePath,
        grant: Page.GRANT_OWNER,
        parent: rootPublicPage._id,
      },
      {
        path: pagePublicAnyoneWithTheLinkPath,
        grant: Page.GRANT_RESTRICTED,
        parent: rootPublicPage._id,
      },
      {
        path: pagePublicOnlyInsideTheGroupPath,
        grant: Page.GRANT_USER_GROUP,
        parent: rootPublicPage._id,
      },
      /*
       * Parent is onlyMe
       */
      {
        path: pageOnlyMePublicPath,
        grant: Page.GRANT_PUBLIC,
        parent: rootOnlyMePage._id,
      },
      {
        path: pageOnlyMeAnyoneWithTheLinkPath,
        grant: Page.GRANT_RESTRICTED,
        parent: rootOnlyMePage._id,
      },
      {
        path: pageOnlyMeOnlyInsideTheGroupPath,
        grant: Page.GRANT_USER_GROUP,
        parent: rootOnlyMePage._id,
      },
      /*
       * Parent is OnlyInsideTheGroup
       */
      {
        path: pageOnlyInsideTheGroupPublicPath,
        grant: Page.GRANT_PUBLIC,
        parent: rootOnlyInsideTheGroup._id,
      },
      {
        path: pageOnlyInsideTheGroupOnlyMePath,
        grant: Page.GRANT_PUBLIC,
        parent: rootOnlyInsideTheGroup._id,
      },
      {
        path: pageOnlyInsideTheGroupAnyoneWithTheLinkPath,
        grant: Page.GRANT_PUBLIC,
        parent: rootOnlyInsideTheGroup._id,
      },
    ]);

    emptyPage1 = (await Page.findOne({ path: emptyPagePath1 }))!;
    emptyPage2 = (await Page.findOne({ path: emptyPagePath2 }))!;
    emptyPage3 = (await Page.findOne({ path: emptyPagePath3 }))!;

    // Leaf pages (Depth: 2)
    await Page.insertMany([
      {
        path: pageE1PublicPath,
        grant: Page.GRANT_PUBLIC,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: null,
        grantedGroups: [],
        parent: emptyPage1._id,
      },
      {
        path: pageE2User1Path,
        grant: Page.GRANT_OWNER,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: [user1._id],
        grantedGroups: [],
        parent: emptyPage2._id,
      },
      {
        path: pageE3GroupParentPath,
        grant: Page.GRANT_USER_GROUP,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: null,
        grantedGroups: [
          { item: groupParent._id, type: GroupType.userGroup },
          { item: externalGroupParent._id, type: GroupType.externalUserGroup },
        ],
        parent: emptyPage3._id,
      },
      {
        path: pageE3GroupChildPath,
        grant: Page.GRANT_USER_GROUP,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: null,
        grantedGroups: [
          { item: groupChild._id, type: GroupType.userGroup },
          { item: externalGroupChild._id, type: GroupType.externalUserGroup },
        ],
        parent: emptyPage3._id,
      },
      {
        path: pageE3User1Path,
        grant: Page.GRANT_OWNER,
        creator: user1,
        lastUpdateUser: user1,
        grantedUsers: [user1._id],
        grantedGroups: [],
        parent: emptyPage3._id,
      },
    ]);
  };

  const createDocumentsToTestGetPageGroupGrantData = async () => {
    await User.insertMany([
      { name: 'User3', username: 'User3', email: 'user3@example.com' },
    ]);
    user3 = await User.findOne({ username: 'User3' });

    groupGrantDataTestParentUserGroupId = new mongoose.Types.ObjectId();
    groupGrantDataTestChildUserGroupId = new mongoose.Types.ObjectId();
    await UserGroup.insertMany([
      {
        _id: groupGrantDataTestParentUserGroupId, // cannotGrant
        name: 'groupGrantDataTestParentGroup',
        parent: null,
      },
      {
        _id: groupGrantDataTestChildUserGroupId, // isGranted
        name: 'groupGrantDataTestChildGroup',
        parent: groupGrantDataTestParentUserGroupId,
      },
    ]);

    await UserGroupRelation.insertMany([
      {
        relatedGroup: groupGrantDataTestParentUserGroupId._id,
        relatedUser: user3._id,
      },
      {
        relatedGroup: groupGrantDataTestChildUserGroupId._id,
        relatedUser: user3._id,
      },
    ]);

    groupGrantDataTestExternalUserGroupId = new mongoose.Types.ObjectId();
    groupGrantDataTestExternalUserGroupId2 = new mongoose.Types.ObjectId();
    await ExternalUserGroup.insertMany([
      {
        _id: groupGrantDataTestExternalUserGroupId,
        name: 'groupGrantDataTestExternalGroup',
        externalId: 'groupGrantDataTestExternalGroup',
        provider: ExternalGroupProviderType.ldap,
        parent: null,
      },
      {
        _id: groupGrantDataTestExternalUserGroupId2,
        name: 'groupGrantDataTestExternalGroup2',
        externalId: 'groupGrantDataTestExternalGroup2',
        provider: ExternalGroupProviderType.ldap,
        parent: null,
      },
    ]);

    await ExternalUserGroupRelation.insertMany([
      {
        relatedGroup: groupGrantDataTestExternalUserGroupId._id,
        relatedUser: user3._id,
      },
    ]);

    const groupGrantDataTestParentPagePath = '/groupGrantDataTestParentPage';
    const groupGrantDataTestParentPageId = new mongoose.Types.ObjectId();
    groupGrantDataTestChildPagePath =
      '/groupGrantDataTestParentPage/groupGrantDataTestChildPagePath';
    await Page.insertMany([
      {
        _id: groupGrantDataTestParentPageId,
        path: groupGrantDataTestParentPagePath,
        grant: Page.GRANT_USER_GROUP,
        creator: user3._id,
        lastUpdateUser: user3._id,
        grantedUsers: null,
        grantedGroups: [
          {
            item: groupGrantDataTestChildUserGroupId._id,
            type: GroupType.userGroup,
          },
          {
            item: groupGrantDataTestExternalUserGroupId._id,
            type: GroupType.externalUserGroup,
          },
          {
            item: groupGrantDataTestExternalUserGroupId2._id,
            type: GroupType.externalUserGroup,
          },
        ],
        parent: rootPage._id,
      },
      {
        path: groupGrantDataTestChildPagePath,
        grant: Page.GRANT_USER_GROUP,
        creator: user3._id,
        lastUpdateUser: user3._id,
        grantedUsers: null,
        grantedGroups: [
          {
            item: groupGrantDataTestChildUserGroupId._id,
            type: GroupType.userGroup,
          },
          {
            item: groupGrantDataTestExternalUserGroupId2._id,
            type: GroupType.externalUserGroup,
          },
        ],
        parent: groupGrantDataTestParentPageId,
      },
    ]);
  };

  /*
   * prepare before all tests
   */
  beforeAll(async () => {
    crowi = await getInstance();

    pageGrantService = crowi.pageGrantService;

    User = mongoose.model('User');
    Page = mongoose.model<IPage, PageModel>('Page');

    rootPage = (await Page.findOne({ path: '/' }))!;

    await createDocumentsToTestIsGrantNormalized();
    await createDocumentsToTestGetPageGroupGrantData();
  });

  describe('Test isGrantNormalized method with shouldCheckDescendants false', () => {
    test('Should return true when Ancestor: root, Target: public', async () => {
      const targetPath = '/NEW';
      const grant = Page.GRANT_PUBLIC;
      const grantedUserIds = undefined;
      const grantedGroupIds = [];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return true when Ancestor: root, Target: GroupParent', async () => {
      const targetPath = '/NEW_GroupParent';
      const grant = Page.GRANT_USER_GROUP;
      const grantedUserIds = undefined;
      const grantedGroupIds = [
        { item: groupParent._id, type: GroupType.userGroup },
        { item: externalGroupParent._id, type: GroupType.externalUserGroup },
      ];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return true when Ancestor: under-root public, Target: public', async () => {
      const targetPath = `${pageRootPublicPath}/NEW`;
      const grant = Page.GRANT_PUBLIC;
      const grantedUserIds = undefined;
      const grantedGroupIds = [];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return true when Ancestor: under-root GroupParent, Target: GroupParent', async () => {
      const targetPath = `${pageRootGroupParentPath}/NEW`;
      const grant = Page.GRANT_USER_GROUP;
      const grantedUserIds = undefined;
      const grantedGroupIds = [
        { item: groupParent._id, type: GroupType.userGroup },
        { item: externalGroupParent._id, type: GroupType.externalUserGroup },
      ];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return true when Ancestor: public, Target: public', async () => {
      const targetPath = `${pageE1PublicPath}/NEW`;
      const grant = Page.GRANT_PUBLIC;
      const grantedUserIds = undefined;
      const grantedGroupIds = [];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return true when Ancestor: owned by User1, Target: owned by User1', async () => {
      const targetPath = `${pageE2User1Path}/NEW`;
      const grant = Page.GRANT_OWNER;
      const grantedUserIds = [user1._id];
      const grantedGroupIds = [];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return false when Ancestor: owned by GroupParent, Target: public', async () => {
      const targetPath = `${pageE3GroupParentPath}/NEW`;
      const grant = Page.GRANT_PUBLIC;
      const grantedUserIds = undefined;
      const grantedGroupIds = [];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(false);
    });

    test('Should return false when Ancestor: owned by GroupChild, Target: GroupParent', async () => {
      const targetPath = `${pageE3GroupChildPath}/NEW`;
      const grant = Page.GRANT_USER_GROUP;
      const grantedUserIds = undefined;
      const grantedGroupIds = [
        { item: groupParent._id, type: GroupType.userGroup },
        { item: externalGroupParent._id, type: GroupType.externalUserGroup },
      ];
      const shouldCheckDescendants = false;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(false);
    });
  });

  describe('Test isGrantNormalized method with shouldCheckDescendants true', () => {
    test('Should return true when Target: public, Descendant: public', async () => {
      const targetPath = emptyPagePath1;
      const grant = Page.GRANT_PUBLIC;
      const grantedUserIds = undefined;
      const grantedGroupIds = [];
      const shouldCheckDescendants = true;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return true when Target: owned by User1, Descendant: User1 only', async () => {
      const targetPath = emptyPagePath2;
      const grant = Page.GRANT_OWNER;
      const grantedUserIds = [user1._id];
      const grantedGroupIds = [];
      const shouldCheckDescendants = true;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return true when Target: owned by GroupParent, Descendant: GroupParent, GroupChild and User1', async () => {
      const targetPath = emptyPagePath3;
      const grant = Page.GRANT_USER_GROUP;
      const grantedUserIds = undefined;
      const grantedGroupIds = [
        { item: groupParent._id, type: GroupType.userGroup },
        { item: externalGroupParent._id, type: GroupType.externalUserGroup },
      ];
      const shouldCheckDescendants = true;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(true);
    });

    test('Should return false when Target: owned by User1, Descendant: public', async () => {
      const targetPath = emptyPagePath1;
      const grant = Page.GRANT_OWNER;
      const grantedUserIds = [user1._id];
      const grantedGroupIds = [];
      const shouldCheckDescendants = true;

      const result = await pageGrantService.isGrantNormalized(
        user1,
        targetPath,
        grant,
        grantedUserIds,
        grantedGroupIds,
        shouldCheckDescendants,
      );

      expect(result).toBe(false);
    });
  });

  describe('Test validateGrantChange method', () => {
    test('Should return true when Target: completely owned by User1 (belongs to all groups)', async () => {
      const grant = Page.GRANT_PUBLIC;
      const grantedGroupIds = [];

      const result = await pageGrantService.validateGrantChange(
        user1,
        multipleGroupTreesAndUsersPage.grantedGroups,
        grant,
        grantedGroupIds,
      );

      expect(result).toBe(true);
    });

    test('Should return false when Target: partially owned by User2 (belongs to one of the groups), and change to public grant', async () => {
      const grant = Page.GRANT_PUBLIC;
      const grantedGroupIds = [];

      const result = await pageGrantService.validateGrantChange(
        user2,
        multipleGroupTreesAndUsersPage.grantedGroups,
        grant,
        grantedGroupIds,
      );

      expect(result).toBe(false);
    });

    test('Should return false when Target: partially owned by User2 (belongs to one of the groups), and change to owner grant', async () => {
      const grant = Page.GRANT_OWNER;
      const grantedGroupIds = [];

      const result = await pageGrantService.validateGrantChange(
        user2,
        multipleGroupTreesAndUsersPage.grantedGroups,
        grant,
        grantedGroupIds,
      );

      expect(result).toBe(false);
    });

    test('Should return false when Target: partially owned by User2 (belongs to one of the groups), and change to restricted grant', async () => {
      const grant = Page.GRANT_RESTRICTED;
      const grantedGroupIds = [];

      const result = await pageGrantService.validateGrantChange(
        user2,
        multipleGroupTreesAndUsersPage.grantedGroups,
        grant,
        grantedGroupIds,
      );

      expect(result).toBe(false);
    });

    test('Should return false when Target: partially owned by User2, and change to group grant without any groups of user2', async () => {
      const grant = Page.GRANT_USER_GROUP;
      const grantedGroupIds = [
        { item: differentTreeGroup._id, type: GroupType.userGroup },
      ];

      const result = await pageGrantService.validateGrantChange(
        user2,
        multipleGroupTreesAndUsersPage.grantedGroups,
        grant,
        grantedGroupIds,
      );

      expect(result).toBe(false);
    });
  });

  describe('Test for calcApplicableGrantData', () => {
    test('Only Public is Applicable in case of top page', async () => {
      const result = await pageGrantService.calcApplicableGrantData(
        rootPage,
        user1,
      );

      expect(result).toStrictEqual({
        [PageGrant.GRANT_PUBLIC]: null,
      });
    });

    // parent property of all private pages is null
    test('Any grant is allowed if parent is null', async () => {
      const userRelatedUserGroups =
        await UserGroupRelation.findAllGroupsForUser(user1);
      const userRelatedExternalUserGroups =
        await ExternalUserGroupRelation.findAllGroupsForUser(user1);
      const userRelatedGroups = [
        ...userRelatedUserGroups.map((group) => {
          return { type: GroupType.userGroup, item: group };
        }),
        ...userRelatedExternalUserGroups.map((group) => {
          return { type: GroupType.externalUserGroup, item: group };
        }),
      ];

      // OnlyMe
      const rootOnlyMePage = await Page.findOne({
        path: v4PageRootOnlyMePagePath,
      });
      const rootOnlyMePageRes = await pageGrantService.calcApplicableGrantData(
        rootOnlyMePage,
        user1,
      );
      expect(rootOnlyMePageRes).toStrictEqual({
        [PageGrant.GRANT_PUBLIC]: null,
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups: userRelatedGroups },
      });

      // AnyoneWithTheLink
      const rootAnyoneWithTheLinkPage = await Page.findOne({
        path: v4PageRootAnyoneWithTheLinkPagePath,
      });
      const anyoneWithTheLinkRes =
        await pageGrantService.calcApplicableGrantData(
          rootAnyoneWithTheLinkPage,
          user1,
        );
      expect(anyoneWithTheLinkRes).toStrictEqual({
        [PageGrant.GRANT_PUBLIC]: null,
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups: userRelatedGroups },
      });

      // OnlyInsideTheGroup
      const rootOnlyInsideTheGroupPage = await Page.findOne({
        path: v4PageRootOnlyInsideTheGroupPagePath,
      });
      const onlyInsideTheGroupRes =
        await pageGrantService.calcApplicableGrantData(
          rootOnlyInsideTheGroupPage,
          user1,
        );
      expect(onlyInsideTheGroupRes).toStrictEqual({
        [PageGrant.GRANT_PUBLIC]: null,
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups: userRelatedGroups },
      });
    });

    test('Any grant is allowed if parent is public', async () => {
      const userRelatedUserGroups =
        await UserGroupRelation.findAllGroupsForUser(user1);
      const userRelatedExternalUserGroups =
        await ExternalUserGroupRelation.findAllGroupsForUser(user1);
      const userRelatedGroups = [
        ...userRelatedUserGroups.map((group) => {
          return { type: GroupType.userGroup, item: group };
        }),
        ...userRelatedExternalUserGroups.map((group) => {
          return { type: GroupType.externalUserGroup, item: group };
        }),
      ];

      // OnlyMe
      const publicOnlyMePage = await Page.findOne({
        path: pagePublicOnlyMePath,
      });
      const publicOnlyMeRes = await pageGrantService.calcApplicableGrantData(
        publicOnlyMePage,
        user1,
      );
      expect(publicOnlyMeRes).toStrictEqual({
        [PageGrant.GRANT_PUBLIC]: null,
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups: userRelatedGroups },
      });

      // AnyoneWithTheLink
      const publicAnyoneWithTheLinkPage = await Page.findOne({
        path: pagePublicAnyoneWithTheLinkPath,
      });
      const publicAnyoneWithTheLinkRes =
        await pageGrantService.calcApplicableGrantData(
          publicAnyoneWithTheLinkPage,
          user1,
        );
      expect(publicAnyoneWithTheLinkRes).toStrictEqual({
        [PageGrant.GRANT_PUBLIC]: null,
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups: userRelatedGroups },
      });

      // OnlyInsideTheGroup
      const publicOnlyInsideTheGroupPage = await Page.findOne({
        path: pagePublicOnlyInsideTheGroupPath,
      });
      const publicOnlyInsideTheGroupRes =
        await pageGrantService.calcApplicableGrantData(
          publicOnlyInsideTheGroupPage,
          user1,
        );
      expect(publicOnlyInsideTheGroupRes).toStrictEqual({
        [PageGrant.GRANT_PUBLIC]: null,
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups: userRelatedGroups },
      });
    });

    test('Only "GRANT_OWNER" is allowed if the user is the parent page\'s grantUser', async () => {
      // Public
      const onlyMePublicPage = await Page.findOne({
        path: pageOnlyMePublicPath,
      });
      const onlyMePublicRes = await pageGrantService.calcApplicableGrantData(
        onlyMePublicPage,
        user1,
      );
      expect(onlyMePublicRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
      });

      // AnyoneWithTheLink
      const onlyMeAnyoneWithTheLinkPage = await Page.findOne({
        path: pageOnlyMeAnyoneWithTheLinkPath,
      });
      const onlyMeAnyoneWithTheLinkRes =
        await pageGrantService.calcApplicableGrantData(
          onlyMeAnyoneWithTheLinkPage,
          user1,
        );
      expect(onlyMeAnyoneWithTheLinkRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
      });

      // OnlyInsideTheGroup
      const publicOnlyInsideTheGroupPage = await Page.findOne({
        path: pageOnlyMeOnlyInsideTheGroupPath,
      });
      const publicOnlyInsideTheGroupRes =
        await pageGrantService.calcApplicableGrantData(
          publicOnlyInsideTheGroupPage,
          user1,
        );
      expect(publicOnlyInsideTheGroupRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
      });
    });

    test('"GRANT_OWNER" is not allowed if the user is not the parent page\'s grantUser', async () => {
      // Public
      const onlyMePublicPage = await Page.findOne({
        path: pageOnlyMePublicPath,
      });
      const onlyMePublicRes = await pageGrantService.calcApplicableGrantData(
        onlyMePublicPage,
        user2,
      );
      expect(onlyMePublicRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
      });

      // AnyoneWithTheLink
      const onlyMeAnyoneWithTheLinkPage = await Page.findOne({
        path: pageOnlyMeAnyoneWithTheLinkPath,
      });
      const onlyMeAnyoneWithTheLinkRes =
        await pageGrantService.calcApplicableGrantData(
          onlyMeAnyoneWithTheLinkPage,
          user2,
        );
      expect(onlyMeAnyoneWithTheLinkRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
      });

      // OnlyInsideTheGroup
      const publicOnlyInsideTheGroupPage = await Page.findOne({
        path: pageOnlyMeOnlyInsideTheGroupPath,
      });
      const publicOnlyInsideTheGroupRes =
        await pageGrantService.calcApplicableGrantData(
          publicOnlyInsideTheGroupPage,
          user2,
        );
      expect(publicOnlyInsideTheGroupRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
      });
    });

    test('"GRANT_USER_GROUP" is allowed if the parent\'s grant is GRANT_USER_GROUP and the user is included in the group', async () => {
      const userGroups =
        await UserGroupRelation.findGroupsWithDescendantsByGroupAndUser(
          groupParent,
          user1,
        );
      const externalUserGroups =
        await ExternalUserGroupRelation.findGroupsWithDescendantsByGroupAndUser(
          externalGroupParent,
          user1,
        );
      const applicableGroups = [
        ...userGroups.map((group) => {
          return { type: GroupType.userGroup, item: group };
        }),
        ...externalUserGroups.map((group) => {
          return { type: GroupType.externalUserGroup, item: group };
        }),
      ];

      // Public
      const onlyInsideGroupPublicPage = await Page.findOne({
        path: pageOnlyInsideTheGroupPublicPath,
      });
      const onlyInsideGroupPublicRes =
        await pageGrantService.calcApplicableGrantData(
          onlyInsideGroupPublicPage,
          user1,
        );
      expect(onlyInsideGroupPublicRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups },
      });

      // OnlyMe
      const onlyInsideTheGroupOnlyMePage = await Page.findOne({
        path: pageOnlyInsideTheGroupOnlyMePath,
      });
      const onlyInsideTheGroupOnlyMeRes =
        await pageGrantService.calcApplicableGrantData(
          onlyInsideTheGroupOnlyMePage,
          user1,
        );
      expect(onlyInsideTheGroupOnlyMeRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups },
      });

      // AnyoneWithTheLink
      const onlyInsideTheGroupAnyoneWithTheLinkPage = await Page.findOne({
        path: pageOnlyInsideTheGroupAnyoneWithTheLinkPath,
      });
      const onlyInsideTheGroupAnyoneWithTheLinkRes =
        await pageGrantService.calcApplicableGrantData(
          onlyInsideTheGroupAnyoneWithTheLinkPage,
          user1,
        );
      expect(onlyInsideTheGroupAnyoneWithTheLinkRes).toStrictEqual({
        [PageGrant.GRANT_RESTRICTED]: null,
        [PageGrant.GRANT_OWNER]: null,
        [PageGrant.GRANT_USER_GROUP]: { applicableGroups },
      });
    });
  });
  describe('Test for getPageGroupGrantData', () => {
    test('return expected group grant data', async () => {
      const groupGrantDataTestChildPage = await Page.findOne({
        path: groupGrantDataTestChildPagePath,
      });
      const result = await pageGrantService.getPageGroupGrantData(
        groupGrantDataTestChildPage,
        user3,
      );
      expect(result).toStrictEqual({
        userRelatedGroups: [
          {
            id: groupGrantDataTestExternalUserGroupId.toString(),
            name: 'groupGrantDataTestExternalGroup',
            type: GroupType.externalUserGroup,
            provider: ExternalGroupProviderType.ldap,
            status: UserGroupPageGrantStatus.notGranted,
          },
          {
            id: groupGrantDataTestChildUserGroupId.toString(),
            name: 'groupGrantDataTestChildGroup',
            type: GroupType.userGroup,
            provider: undefined,
            status: UserGroupPageGrantStatus.isGranted,
          },
          {
            id: groupGrantDataTestParentUserGroupId.toString(),
            name: 'groupGrantDataTestParentGroup',
            type: GroupType.userGroup,
            provider: undefined,
            status: UserGroupPageGrantStatus.cannotGrant,
          },
        ],
        nonUserRelatedGrantedGroups: [
          {
            id: groupGrantDataTestExternalUserGroupId2.toString(),
            name: 'groupGrantDataTestExternalGroup2',
            type: GroupType.externalUserGroup,
            provider: ExternalGroupProviderType.ldap,
          },
        ],
      });
    });

    test('return empty arrays when page is root', async () => {
      const result = await pageGrantService.getPageGroupGrantData(
        rootPage,
        user1,
      );
      expect(result).toStrictEqual({
        userRelatedGroups: [],
        nonUserRelatedGrantedGroups: [],
      });
    });
  });
});
