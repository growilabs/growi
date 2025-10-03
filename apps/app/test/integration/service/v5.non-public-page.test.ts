/* eslint-disable no-unused-vars */
import {
  GroupType,
  type IGrantedGroup,
  type IPage,
  type IRevision,
} from '@growi/core';
import mongoose from 'mongoose';

import { ExternalGroupProviderType } from '../../../src/features/external-user-group/interfaces/external-user-group';
import ExternalUserGroup from '../../../src/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '../../../src/features/external-user-group/server/models/external-user-group-relation';
import type { IPageTagRelation } from '../../../src/interfaces/page-tag-relation';
import type Crowi from '../../../src/server/crowi';
import type { PageDocument, PageModel } from '../../../src/server/models/page';
import PageTagRelation from '../../../src/server/models/page-tag-relation';
import type {
  IRevisionDocument,
  IRevisionModel,
} from '../../../src/server/models/revision';
import Tag from '../../../src/server/models/tag';
import UserGroup from '../../../src/server/models/user-group';
import UserGroupRelation from '../../../src/server/models/user-group-relation';
import { generalXssFilter } from '../../../src/services/general-xss-filter';
import { getInstance } from '../setup-crowi';

describe('PageService page operations with non-public pages', () => {
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let dummyUser1;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let dummyUser2;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let npDummyUser1;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let npDummyUser2;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let npDummyUser3;
  let groupIdIsolate: mongoose.Types.ObjectId;
  let groupIdA: mongoose.Types.ObjectId;
  let groupIdB: mongoose.Types.ObjectId;
  let groupIdC: mongoose.Types.ObjectId;
  let externalGroupIdIsolate: mongoose.Types.ObjectId;
  let externalGroupIdA: mongoose.Types.ObjectId;
  let externalGroupIdB: mongoose.Types.ObjectId;
  let externalGroupIdC: mongoose.Types.ObjectId;
  let crowi: Crowi;
  let Page: PageModel;
  let Revision: IRevisionModel;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let User;
  let generalXssFilterProcessSpy: jest.SpyInstance;

  let rootPage: PageDocument;

  /**
   * Rename
   */
  const pageIdRename1 = new mongoose.Types.ObjectId();
  const pageIdRename2 = new mongoose.Types.ObjectId();
  const pageIdRename3 = new mongoose.Types.ObjectId();
  const pageIdRename4 = new mongoose.Types.ObjectId();
  const pageIdRename5 = new mongoose.Types.ObjectId();
  const pageIdRename6 = new mongoose.Types.ObjectId();
  const pageIdRename7 = new mongoose.Types.ObjectId();
  const pageIdRename8 = new mongoose.Types.ObjectId();
  const pageIdRename9 = new mongoose.Types.ObjectId();

  /**
   * Duplicate
   */
  // page id
  const pageIdDuplicate1 = new mongoose.Types.ObjectId();
  const pageIdDuplicate2 = new mongoose.Types.ObjectId();
  const pageIdDuplicate3 = new mongoose.Types.ObjectId();
  const pageIdDuplicate4 = new mongoose.Types.ObjectId();
  const pageIdDuplicate5 = new mongoose.Types.ObjectId();
  const pageIdDuplicate6 = new mongoose.Types.ObjectId();
  const pageIdDuplicate7 = new mongoose.Types.ObjectId();
  const pageIdDuplicate8 = new mongoose.Types.ObjectId();
  const pageIdDuplicate9 = new mongoose.Types.ObjectId();
  // revision id
  const revisionIdDuplicate1 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate2 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate3 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate4 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate5 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate6 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate7 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate8 = new mongoose.Types.ObjectId();
  const revisionIdDuplicate9 = new mongoose.Types.ObjectId();

  /**
   * Revert
   */
  // page id
  const pageIdRevert1 = new mongoose.Types.ObjectId();
  const pageIdRevert2 = new mongoose.Types.ObjectId();
  const pageIdRevert3 = new mongoose.Types.ObjectId();
  const pageIdRevert4 = new mongoose.Types.ObjectId();
  const pageIdRevert5 = new mongoose.Types.ObjectId();
  const pageIdRevert6 = new mongoose.Types.ObjectId();
  // revision id
  const revisionIdRevert1 = new mongoose.Types.ObjectId();
  const revisionIdRevert2 = new mongoose.Types.ObjectId();
  const revisionIdRevert3 = new mongoose.Types.ObjectId();
  const revisionIdRevert4 = new mongoose.Types.ObjectId();
  const revisionIdRevert5 = new mongoose.Types.ObjectId();
  const revisionIdRevert6 = new mongoose.Types.ObjectId();
  // tag id
  const tagIdRevert1 = new mongoose.Types.ObjectId();
  const tagIdRevert2 = new mongoose.Types.ObjectId();

  const create = async (path, body, user, options = {}) => {
    const mockedCreateSubOperation = jest
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(null);

    const createdPage = await crowi.pageService.create(
      path,
      body,
      user,
      options,
    );

    const argsForCreateSubOperation = mockedCreateSubOperation.mock.calls[0];

    mockedCreateSubOperation.mockRestore();

    await crowi.pageService.createSubOperation(
      ...(argsForCreateSubOperation as Parameters<
        typeof crowi.pageService.createSubOperation
      >),
    );

    return createdPage;
  };

  // normalize for result comparison
  const normalizeGrantedGroups = (
    grantedGroups: IGrantedGroup[] | undefined,
  ) => {
    return grantedGroups?.map((group) => {
      const itemId =
        typeof group.item === 'string' ? group.item : group.item._id;
      return { item: itemId, type: group.type };
    });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model('User');
    Page = mongoose.model<IPage, PageModel>('Page');
    Revision = mongoose.model<IRevision, IRevisionModel>('Revision');

    /*
     * Common
     */

    const npUserId1 = new mongoose.Types.ObjectId();
    const npUserId2 = new mongoose.Types.ObjectId();
    const npUserId3 = new mongoose.Types.ObjectId();
    await User.insertMany([
      {
        _id: npUserId1,
        name: 'npUser1',
        username: 'npUser1',
        email: 'npUser1@example.com',
      },
      {
        _id: npUserId2,
        name: 'npUser2',
        username: 'npUser2',
        email: 'npUser2@example.com',
      },
      {
        _id: npUserId3,
        name: 'npUser3',
        username: 'npUser3',
        email: 'npUser3@example.com',
      },
    ]);

    groupIdIsolate = new mongoose.Types.ObjectId();
    groupIdA = new mongoose.Types.ObjectId();
    groupIdB = new mongoose.Types.ObjectId();
    groupIdC = new mongoose.Types.ObjectId();
    await UserGroup.insertMany([
      {
        _id: groupIdIsolate,
        name: 'np_groupIsolate',
      },
      {
        _id: groupIdA,
        name: 'np_groupA',
      },
      {
        _id: groupIdB,
        name: 'np_groupB',
        parent: groupIdA,
      },
      {
        _id: groupIdC,
        name: 'np_groupC',
        parent: groupIdB,
      },
    ]);

    await UserGroupRelation.insertMany([
      {
        relatedGroup: groupIdIsolate,
        relatedUser: npUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdIsolate,
        relatedUser: npUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdA,
        relatedUser: npUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdA,
        relatedUser: npUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdA,
        relatedUser: npUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdB,
        relatedUser: npUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdB,
        relatedUser: npUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdC,
        relatedUser: npUserId3,
        createdAt: new Date(),
      },
    ]);

    // Insert ExternalUserGroups with the same group structure as UserGroups
    // Use to test
    //   - ExternalUserGroup
    //   - Case of multiple grantedGroups for Page
    externalGroupIdIsolate = new mongoose.Types.ObjectId();
    externalGroupIdA = new mongoose.Types.ObjectId();
    externalGroupIdB = new mongoose.Types.ObjectId();
    externalGroupIdC = new mongoose.Types.ObjectId();
    await ExternalUserGroup.insertMany([
      {
        _id: externalGroupIdIsolate,
        name: 'np_externalGroupIsolate',
        externalId: 'np_externalGroupIsolate',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: externalGroupIdA,
        name: 'np_externalGroupA',
        externalId: 'np_externalGroupA',
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: externalGroupIdB,
        name: 'np_externalGroupB',
        externalId: 'np_externalGroupB',
        parent: externalGroupIdA,
        provider: ExternalGroupProviderType.ldap,
      },
      {
        _id: externalGroupIdC,
        name: 'np_externalGroupC',
        externalId: 'np_externalGroupC',
        parent: externalGroupIdB,
        provider: ExternalGroupProviderType.ldap,
      },
    ]);

    await ExternalUserGroupRelation.insertMany([
      {
        relatedGroup: externalGroupIdIsolate,
        relatedUser: npUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalGroupIdIsolate,
        relatedUser: npUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalGroupIdA,
        relatedUser: npUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalGroupIdA,
        relatedUser: npUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalGroupIdA,
        relatedUser: npUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalGroupIdB,
        relatedUser: npUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalGroupIdB,
        relatedUser: npUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: externalGroupIdC,
        relatedUser: npUserId3,
        createdAt: new Date(),
      },
    ]);

    generalXssFilterProcessSpy = jest.spyOn(generalXssFilter, 'process');

    dummyUser1 = await User.findOne({ username: 'v5DummyUser1' });
    dummyUser2 = await User.findOne({ username: 'v5DummyUser2' });
    npDummyUser1 = await User.findOne({ username: 'npUser1' });
    npDummyUser2 = await User.findOne({ username: 'npUser2' });
    npDummyUser3 = await User.findOne({ username: 'npUser3' });

    rootPage = (await Page.findOne({ path: '/' }))!;
    if (rootPage == null) {
      const pages = await Page.insertMany([
        { path: '/', grant: Page.GRANT_PUBLIC },
      ]);
      rootPage = pages[0];
    }

    /**
     * create
     * mc_ => model create
     * emp => empty => page with isEmpty: true
     * pub => public => GRANT_PUBLIC
     */
    const pageIdCreate1 = new mongoose.Types.ObjectId();
    const pageIdCreate2 = new mongoose.Types.ObjectId();
    const pageIdCreate3 = new mongoose.Types.ObjectId();
    await Page.insertMany([
      {
        _id: pageIdCreate1,
        path: '/mc4_top/mc1_emp',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        path: '/mc4_top/mc1_emp/mc2_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdCreate1,
        isEmpty: false,
      },
      {
        path: '/mc5_top/mc3_awl',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        _id: pageIdCreate2,
        path: '/mc4_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        _id: pageIdCreate3,
        path: '/mc5_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        path: '/mc6_top',
        grant: Page.GRANT_USER_GROUP,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
        grantedGroups: [
          { item: groupIdIsolate, type: GroupType.userGroup },
          { item: groupIdB, type: GroupType.userGroup },
        ],
      },
    ]);

    /**
     * create
     * mc_ => model create
     * emp => empty => page with isEmpty: true
     * pub => public => GRANT_PUBLIC
     */
    const pageIdCreateBySystem1 = new mongoose.Types.ObjectId();
    const pageIdCreateBySystem2 = new mongoose.Types.ObjectId();
    const pageIdCreateBySystem3 = new mongoose.Types.ObjectId();
    await Page.insertMany([
      {
        _id: pageIdCreateBySystem1,
        path: '/mc4_top_by_system/mc1_emp_by_system',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        path: '/mc4_top_by_system/mc1_emp_by_system/mc2_pub_by_system',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdCreateBySystem1,
        isEmpty: false,
      },
      {
        path: '/mc5_top_by_system/mc3_awl_by_system',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        _id: pageIdCreateBySystem2,
        path: '/mc4_top_by_system',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        _id: pageIdCreateBySystem3,
        path: '/mc5_top_by_system',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
    ]);

    /*
     * Rename
     */
    await Page.insertMany([
      {
        _id: pageIdRename1,
        path: '/np_rename1_destination',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1._id,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdRename2,
        path: '/np_rename2',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser2._id,
        lastUpdateUser: npDummyUser2._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdRename3,
        path: '/np_rename2/np_rename3',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdC, type: GroupType.userGroup },
          { item: externalGroupIdC, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser3._id,
        lastUpdateUser: npDummyUser3._id,
        parent: pageIdRename2._id,
      },
      {
        _id: pageIdRename4,
        path: '/np_rename4_destination',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdIsolate, type: GroupType.userGroup },
          { item: externalGroupIdIsolate, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser3._id,
        lastUpdateUser: npDummyUser3._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdRename5,
        path: '/np_rename5',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser2._id,
        lastUpdateUser: npDummyUser2._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdRename6,
        path: '/np_rename5/np_rename6',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser2._id,
        lastUpdateUser: npDummyUser2._id,
        parent: pageIdRename5,
      },
      {
        _id: pageIdRename7,
        path: '/np_rename7_destination',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdIsolate, type: GroupType.userGroup },
          { item: externalGroupIdIsolate, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser2._id,
        lastUpdateUser: npDummyUser2._id,
        parent: pageIdRename5,
      },
      {
        _id: pageIdRename8,
        path: '/np_rename8',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1._id,
        lastUpdateUser: dummyUser1._id,
      },
      {
        _id: pageIdRename9,
        path: '/np_rename8/np_rename9',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser2._id,
        lastUpdateUser: dummyUser2._id,
      },
    ]);
    /*
     * Duplicate
     */
    await Page.insertMany([
      {
        _id: pageIdDuplicate1,
        path: '/np_duplicate1',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1._id,
        lastUpdateUser: dummyUser1._id,
        revision: revisionIdDuplicate1,
      },
      {
        _id: pageIdDuplicate2,
        path: '/np_duplicate2',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser1._id,
        lastUpdateUser: npDummyUser1._id,
        revision: revisionIdDuplicate2,
        parent: rootPage._id,
      },
      {
        _id: pageIdDuplicate3,
        path: '/np_duplicate2/np_duplicate3',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
        creator: npDummyUser2._id,
        lastUpdateUser: npDummyUser2._id,
        revision: revisionIdDuplicate3,
        parent: pageIdDuplicate2,
      },
      {
        _id: pageIdDuplicate4,
        path: '/np_duplicate4',
        grant: Page.GRANT_PUBLIC,
        creator: npDummyUser1._id,
        lastUpdateUser: npDummyUser1._id,
        revision: revisionIdDuplicate4,
        parent: rootPage._id,
      },
      {
        _id: pageIdDuplicate5,
        path: '/np_duplicate4/np_duplicate5',
        grant: Page.GRANT_RESTRICTED,
        creator: npDummyUser1._id,
        lastUpdateUser: npDummyUser1._id,
        revision: revisionIdDuplicate5,
      },
      {
        _id: pageIdDuplicate6,
        path: '/np_duplicate4/np_duplicate6',
        grant: Page.GRANT_PUBLIC,
        creator: npDummyUser1._id,
        lastUpdateUser: npDummyUser1._id,
        parent: pageIdDuplicate4,
        revision: revisionIdDuplicate6,
      },
      {
        _id: pageIdDuplicate7,
        path: '/np_duplicate7',
        grant: Page.GRANT_USER_GROUP,
        creator: npDummyUser1._id,
        lastUpdateUser: npDummyUser1._id,
        parent: rootPage._id,
        revision: revisionIdDuplicate7,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
      },
      {
        _id: pageIdDuplicate8,
        path: '/np_duplicate7/np_duplicate8',
        grant: Page.GRANT_USER_GROUP,
        creator: npDummyUser3._id,
        lastUpdateUser: npDummyUser3._id,
        parent: pageIdDuplicate7,
        revision: revisionIdDuplicate8,
        grantedGroups: [
          { item: groupIdC, type: GroupType.userGroup },
          { item: externalGroupIdC, type: GroupType.externalUserGroup },
        ],
      },
      {
        _id: pageIdDuplicate9,
        path: '/np_duplicate7/np_duplicate9',
        grant: Page.GRANT_OWNER,
        creator: npDummyUser2._id,
        lastUpdateUser: npDummyUser2._id,
        parent: pageIdDuplicate7,
        revision: revisionIdDuplicate9,
        grantedUsers: [npDummyUser2._id],
      },
    ]);
    await Revision.insertMany([
      {
        _id: revisionIdDuplicate1,
        body: 'np_duplicate1',
        format: 'markdown',
        pageId: pageIdDuplicate1,
        author: npDummyUser1._id,
      },
      {
        _id: revisionIdDuplicate2,
        body: 'np_duplicate2',
        format: 'markdown',
        pageId: pageIdDuplicate2,
        author: npDummyUser2._id,
      },
      {
        _id: revisionIdDuplicate3,
        body: 'np_duplicate3',
        format: 'markdown',
        pageId: pageIdDuplicate3,
        author: npDummyUser2._id,
      },
      {
        _id: revisionIdDuplicate4,
        body: 'np_duplicate4',
        format: 'markdown',
        pageId: pageIdDuplicate4,
        author: npDummyUser2._id,
      },
      {
        _id: revisionIdDuplicate5,
        body: 'np_duplicate5',
        format: 'markdown',
        pageId: pageIdDuplicate5,
        author: npDummyUser2._id,
      },
      {
        _id: revisionIdDuplicate6,
        body: 'np_duplicate6',
        format: 'markdown',
        pageId: pageIdDuplicate6,
        author: npDummyUser1._id,
      },
      {
        _id: revisionIdDuplicate7,
        body: 'np_duplicate7',
        format: 'markdown',
        pageId: pageIdDuplicate7,
        author: npDummyUser1._id,
      },
      {
        _id: revisionIdDuplicate8,
        body: 'np_duplicate8',
        format: 'markdown',
        pageId: pageIdDuplicate8,
        author: npDummyUser3._id,
      },
      {
        _id: revisionIdDuplicate9,
        body: 'np_duplicate9',
        format: 'markdown',
        pageId: pageIdDuplicate9,
        author: npDummyUser2._id,
      },
    ]);

    /**
     * Delete
     */
    const pageIdDelete1 = new mongoose.Types.ObjectId();
    const pageIdDelete2 = new mongoose.Types.ObjectId();
    const pageIdDelete3 = new mongoose.Types.ObjectId();
    const pageIdDelete4 = new mongoose.Types.ObjectId();
    await Page.insertMany([
      {
        _id: pageIdDelete1,
        path: '/npdel1_awl',
        grant: Page.GRANT_RESTRICTED,
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
      },
      {
        _id: pageIdDelete2,
        path: '/npdel2_ug',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        _id: pageIdDelete3,
        path: '/npdel3_top',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 2,
      },
      {
        _id: pageIdDelete4,
        path: '/npdel3_top/npdel4_ug',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: pageIdDelete3._id,
        descendantCount: 1,
      },
      {
        path: '/npdel3_top/npdel4_ug',
        grant: Page.GRANT_RESTRICTED,
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
      },
      {
        path: '/npdel3_top/npdel4_ug/npdel5_ug',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdC, type: GroupType.userGroup },
          { item: externalGroupIdC, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: pageIdDelete4._id,
        descendantCount: 0,
      },
    ]);

    /**
     * Delete completely
     */
    const pageIdDeleteComp1 = new mongoose.Types.ObjectId();
    const pageIdDeleteComp2 = new mongoose.Types.ObjectId();
    await Page.insertMany([
      {
        path: '/npdc1_awl',
        grant: Page.GRANT_RESTRICTED,
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
      },
      {
        path: '/npdc2_ug',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: rootPage._id,
      },
      {
        _id: pageIdDeleteComp1,
        path: '/npdc3_ug',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: rootPage._id,
      },
      {
        _id: pageIdDeleteComp2,
        path: '/npdc3_ug/npdc4_ug',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: pageIdDeleteComp1,
      },
      {
        path: '/npdc3_ug/npdc4_ug/npdc5_ug',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdC, type: GroupType.userGroup },
          { item: externalGroupIdC, type: GroupType.externalUserGroup },
        ],
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
        parent: pageIdDeleteComp2,
      },
      {
        path: '/npdc3_ug/npdc4_ug',
        grant: Page.GRANT_RESTRICTED,
        status: Page.STATUS_PUBLISHED,
        isEmpty: false,
      },
    ]);

    /**
     * Revert
     */
    await Page.insertMany([
      {
        _id: pageIdRevert1,
        path: '/trash/np_revert1',
        grant: Page.GRANT_RESTRICTED,
        revision: revisionIdRevert1,
        status: Page.STATUS_DELETED,
      },
      {
        _id: pageIdRevert2,
        path: '/trash/np_revert2',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
        revision: revisionIdRevert2,
        status: Page.STATUS_DELETED,
      },
      {
        _id: pageIdRevert3,
        path: '/trash/np_revert3',
        revision: revisionIdRevert3,
        status: Page.STATUS_DELETED,
        parent: rootPage._id,
      },
      {
        _id: pageIdRevert4,
        path: '/trash/np_revert3/middle/np_revert4',
        grant: Page.GRANT_RESTRICTED,
        revision: revisionIdRevert4,
        status: Page.STATUS_DELETED,
      },
      {
        _id: pageIdRevert5,
        path: '/trash/np_revert5',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
        revision: revisionIdRevert5,
        status: Page.STATUS_DELETED,
      },
      {
        _id: pageIdRevert6,
        path: '/trash/np_revert5/middle/np_revert6',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [
          { item: groupIdB, type: GroupType.userGroup },
          { item: externalGroupIdB, type: GroupType.externalUserGroup },
        ],
        revision: revisionIdRevert6,
        status: Page.STATUS_DELETED,
      },
    ]);
    await Revision.insertMany([
      {
        _id: revisionIdRevert1,
        pageId: pageIdRevert1,
        body: 'np_revert1',
        format: 'markdown',
        author: dummyUser1._id,
      },
      {
        _id: revisionIdRevert2,
        pageId: pageIdRevert2,
        body: 'np_revert2',
        format: 'markdown',
        author: npDummyUser1,
      },
      {
        _id: revisionIdRevert3,
        pageId: pageIdRevert3,
        body: 'np_revert3',
        format: 'markdown',
        author: npDummyUser1,
      },
      {
        _id: revisionIdRevert4,
        pageId: pageIdRevert4,
        body: 'np_revert4',
        format: 'markdown',
        author: npDummyUser1,
      },
      {
        _id: revisionIdRevert5,
        pageId: pageIdRevert5,
        body: 'np_revert5',
        format: 'markdown',
        author: npDummyUser1,
      },
      {
        _id: revisionIdRevert6,
        pageId: pageIdRevert6,
        body: 'np_revert6',
        format: 'markdown',
        author: npDummyUser1,
      },
    ]);

    await Tag.insertMany([
      { _id: tagIdRevert1, name: 'np_revertTag1' },
      { _id: tagIdRevert2, name: 'np_revertTag2' },
    ]);

    await PageTagRelation.insertMany([
      {
        relatedPage: pageIdRevert1,
        relatedTag: tagIdRevert1,
        isPageTrashed: true,
      },
      {
        relatedPage: pageIdRevert2,
        relatedTag: tagIdRevert2,
        isPageTrashed: true,
      },
    ]);
  });

  describe('create', () => {
    describe('Creating a page using existing path', () => {
      test('with grant RESTRICTED should only create the page and change nothing else', async () => {
        const isGrantNormalizedSpy = jest.spyOn(
          crowi.pageGrantService,
          'isGrantNormalized',
        );
        const pathT = '/mc4_top';
        const path1 = '/mc4_top/mc1_emp';
        const path2 = '/mc4_top/mc1_emp/mc2_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 1 });
        const page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const page2 = await Page.findOne({ path: path2 });
        const page3 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();
        expect(page3).toBeNull();

        // use existing path
        await create(path1, 'new body', dummyUser1, {
          grant: Page.GRANT_RESTRICTED,
        });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const _page2 = await Page.findOne({ path: path2 });
        const _page3 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_pageT?.descendantCount).toBe(1);
        // isGrantNormalized is not called when GRANT RESTRICTED
        expect(isGrantNormalizedSpy).toBeCalledTimes(0);
      });
    });
    describe('Creating a page under a page with grant RESTRICTED', () => {
      test('will create a new empty page with the same path as the grant RESTRECTED page and become a parent', async () => {
        const isGrantNormalizedSpy = jest.spyOn(
          crowi.pageGrantService,
          'isGrantNormalized',
        );
        const pathT = '/mc5_top';
        const path1 = '/mc5_top/mc3_awl';
        const pathN = '/mc5_top/mc3_awl/mc4_pub'; // used to create
        const pageT = await Page.findOne({ path: pathT });
        const page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        const page2 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeNull();

        await create(pathN, 'new body', dummyUser1, {
          grant: Page.GRANT_PUBLIC,
        });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        const _page2 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
          isEmpty: true,
        });
        const _pageN = await Page.findOne({
          path: pathN,
          grant: Page.GRANT_PUBLIC,
        }); // newly crated
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_pageN).toBeTruthy();
        expect(_pageN?.parent).toStrictEqual(_page2?._id);
        expect(_pageT?.descendantCount).toStrictEqual(1);
        // isGrantNormalized is called when GRANT PUBLIC
        expect(isGrantNormalizedSpy).toBeCalledTimes(1);
      });
    });
    describe('Creating a page under a page with grant USER_GROUP', () => {
      describe('When onlyInheritUserRelatedGrantedGroups is true', () => {
        test('Only user related groups should be inherited', async () => {
          const pathT = '/mc6_top';
          const pageT = await Page.findOne({ path: pathT });
          expect(pageT).toBeTruthy();

          const pathN = '/mc6_top/onlyRelatedGroupsInherited'; // path to create
          await create(pathN, 'new body', npDummyUser1, {
            grant: Page.GRANT_USER_GROUP,
            onlyInheritUserRelatedGrantedGroups: true,
          });

          const _pageT = await Page.findOne({ path: pathT });
          const _pageN = await Page.findOne({
            path: pathN,
            grant: Page.GRANT_USER_GROUP,
          }); // newly crated
          expect(_pageT).toBeTruthy();
          expect(_pageN).toBeTruthy();
          expect(_pageN?.parent).toStrictEqual(_pageT?._id);
          expect(_pageT?.descendantCount).toStrictEqual(1);
          expect(normalizeGrantedGroups(_pageN?.grantedGroups)).toStrictEqual([
            { item: groupIdIsolate, type: GroupType.userGroup },
          ]);
        });
      });

      describe('When onlyInheritUserRelatedGrantedGroups is false', () => {
        test('All groups should be inherited', async () => {
          const pathT = '/mc6_top';
          const pageT = await Page.findOne({ path: pathT });
          expect(pageT).toBeTruthy();

          const pathN = '/mc6_top/allGroupsInherited'; // path to create
          await create(pathN, 'new body', npDummyUser1, {
            grant: Page.GRANT_USER_GROUP,
            onlyInheritUserRelatedGrantedGroups: false,
          });

          const _pageT = await Page.findOne({ path: pathT });
          const _pageN = await Page.findOne({
            path: pathN,
            grant: Page.GRANT_USER_GROUP,
          }); // newly crated
          expect(_pageT).toBeTruthy();
          expect(_pageN).toBeTruthy();
          expect(_pageN?.parent).toStrictEqual(_pageT?._id);
          expect(_pageT?.descendantCount).toStrictEqual(2);
          expect(normalizeGrantedGroups(_pageN?.grantedGroups)).toStrictEqual([
            { item: groupIdIsolate, type: GroupType.userGroup },
            { item: groupIdB, type: GroupType.userGroup },
          ]);
        });
      });
    });
  });

  describe('create by system', () => {
    describe('Creating a page using existing path', () => {
      test('with grant RESTRICTED should only create the page and change nothing else', async () => {
        const isGrantNormalizedSpy = jest.spyOn(
          crowi.pageGrantService,
          'isGrantNormalized',
        );
        const pathT = '/mc4_top_by_system';
        const path1 = '/mc4_top_by_system/mc1_emp_by_system';
        const path2 = '/mc4_top_by_system/mc1_emp_by_system/mc2_pub_by_system';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 1 });
        const page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const page2 = await Page.findOne({ path: path2 });
        const page3 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();
        expect(page3).toBeNull();

        // use existing path
        await crowi.pageService.forceCreateBySystem(path1, 'new body', {
          grant: Page.GRANT_RESTRICTED,
        });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        const _page2 = await Page.findOne({ path: path2 });
        const _page3 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_pageT?.descendantCount).toBe(1);
        // isGrantNormalized is not called when create by ststem
        expect(isGrantNormalizedSpy).toBeCalledTimes(0);
      });
    });
    describe('Creating a page under a page with grant RESTRICTED', () => {
      test('will create a new empty page with the same path as the grant RESTRECTED page and become a parent', async () => {
        const isGrantNormalizedSpy = jest.spyOn(
          crowi.pageGrantService,
          'isGrantNormalized',
        );
        const pathT = '/mc5_top_by_system';
        const path1 = '/mc5_top_by_system/mc3_awl_by_system';
        const pathN = '/mc5_top_by_system/mc3_awl_by_system/mc4_pub_by_system'; // used to create
        const pageT = await Page.findOne({ path: pathT });
        const page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        const page2 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
        });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeNull();

        await crowi.pageService.forceCreateBySystem(pathN, 'new body', {
          grant: Page.GRANT_PUBLIC,
        });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_RESTRICTED,
        });
        const _page2 = await Page.findOne({
          path: path1,
          grant: Page.GRANT_PUBLIC,
          isEmpty: true,
        });
        const _pageN = await Page.findOne({
          path: pathN,
          grant: Page.GRANT_PUBLIC,
        }); // newly crated
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_pageN).toBeTruthy();
        expect(_pageN?.parent).toStrictEqual(_page2?._id);
        expect(_pageT?.descendantCount).toStrictEqual(1);
        // isGrantNormalized is not called when create by ststem
        expect(isGrantNormalizedSpy).toBeCalledTimes(0);
      });
    });
  });

  describe('Rename', () => {
    const renamePage = async (
      page,
      newPagePath,
      user,
      options,
      activityParameters?,
    ) => {
      // mock return value
      const mockedRenameSubOperation = jest
        .spyOn(crowi.pageService, 'renameSubOperation')
        .mockReturnValue(null);
      const renamedPage = await crowi.pageService.renamePage(
        page,
        newPagePath,
        user,
        options,
        activityParameters,
      );

      // retrieve the arguments passed when calling method renameSubOperation inside renamePage method
      const argsForRenameSubOperation = mockedRenameSubOperation.mock.calls[0];

      // restores the original implementation
      mockedRenameSubOperation.mockRestore();

      // rename descendants
      if (page.grant !== Page.GRANT_RESTRICTED) {
        await crowi.pageService.renameSubOperation(
          ...(argsForRenameSubOperation as Parameters<
            typeof crowi.pageService.renameSubOperation
          >),
        );
      }

      return renamedPage;
    };

    test('Should rename/move with descendants with grant normalized pages', async () => {
      const _pathD = '/np_rename1_destination';
      const _path2 = '/np_rename2';
      const _path3 = '/np_rename2/np_rename3';
      const _propertiesD = { grant: Page.GRANT_PUBLIC };
      const _properties2 = {
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: { $elemMatch: { item: groupIdB } },
      };
      const _properties3 = {
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: { $elemMatch: { item: groupIdC } },
      };
      const _pageD = await Page.findOne({ path: _pathD, ..._propertiesD });
      const _page2 = await Page.findOne({ path: _path2, ..._properties2 });
      const _page3 = await Page.findOne({
        path: _path3,
        ..._properties3,
        parent: _page2?._id,
      });
      expect(_pageD).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();

      const newPathForPage2 = '/np_rename1_destination/np_rename2';
      const newPathForPage3 = '/np_rename1_destination/np_rename2/np_rename3';
      await renamePage(
        _page2,
        newPathForPage2,
        npDummyUser2,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
          activityId: '62e291bc10e0ab61bd691794',
        },
      );

      const pageD = await Page.findOne({ path: _pathD, ..._propertiesD });
      const page2 = await Page.findOne({ path: _path2, ..._properties2 }); // not exist
      const page3 = await Page.findOne({
        path: _path3,
        ..._properties3,
        parent: _page2?._id,
      }); // not exist
      const page2Renamed = await Page.findOne({ path: newPathForPage2 }); // renamed
      const page3Renamed = await Page.findOne({ path: newPathForPage3 }); // renamed
      expect(pageD).toBeTruthy();
      expect(page2).toBeNull();
      expect(page3).toBeNull();
      expect(page2Renamed).toBeTruthy();
      expect(page3Renamed).toBeTruthy();
      expect(page2Renamed?.parent).toStrictEqual(_pageD?._id);
      expect(page3Renamed?.parent).toStrictEqual(page2Renamed?._id);
      expect(normalizeGrantedGroups(page2Renamed?.grantedGroups)).toStrictEqual(
        normalizeGrantedGroups(_page2?.grantedGroups),
      );
      expect(normalizeGrantedGroups(page3Renamed?.grantedGroups)).toStrictEqual(
        normalizeGrantedGroups(_page3?.grantedGroups),
      );
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
    });
    test('Should throw with NOT grant normalized pages', async () => {
      const _pathD = '/np_rename4_destination';
      const _path2 = '/np_rename5';
      const _path3 = '/np_rename5/np_rename6';
      const _propertiesD = {
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: { $elemMatch: { item: groupIdIsolate } },
      };
      const _properties2 = {
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: { $elemMatch: { item: groupIdB } },
      };
      const _properties3 = {
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: { $elemMatch: { item: groupIdB } },
      };
      const _pageD = await Page.findOne({ path: _pathD, ..._propertiesD }); // isolate
      const _page2 = await Page.findOne({ path: _path2, ..._properties2 }); // groupIdB
      const _page3 = await Page.findOne({
        path: _path3,
        ..._properties3,
        parent: _page2,
      }); // groupIdB
      expect(_pageD).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();

      const newPathForPage2 = '/np_rename4_destination/np_rename5';
      const newPathForPage3 = '/np_rename4_destination/np_rename5/np_rename6';
      let isThrown = false;
      try {
        await renamePage(
          _page2,
          newPathForPage2,
          dummyUser1,
          {},
          {
            ip: '::ffff:127.0.0.1',
            endpoint: '/_api/v3/pages/rename',
            activityId: '62e291bc10e0ab61bd691794',
          },
        );
      } catch (err) {
        isThrown = true;
      }
      expect(isThrown).toBe(true);
      const page2 = await Page.findOne({ path: _path2 }); // not renamed thus exist
      const page3 = await Page.findOne({ path: _path3 }); // not renamed thus exist
      const page2Renamed = await Page.findOne({ path: newPathForPage2 }); // not exist
      const page3Renamed = await Page.findOne({ path: newPathForPage3 }); // not exist
      expect(page2).toBeTruthy();
      expect(page3).toBeTruthy();
      expect(page2Renamed).toBeNull();
      expect(page3Renamed).toBeNull();
    });
    test('Should rename/move multiple pages: child page with GRANT_RESTRICTED should NOT be renamed.', async () => {
      const _pathD = '/np_rename7_destination';
      const _path2 = '/np_rename8';
      const _path3 = '/np_rename8/np_rename9';
      const _pageD = await Page.findOne({
        path: _pathD,
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: { $elemMatch: { item: groupIdIsolate } },
      });
      const _page2 = await Page.findOne({
        path: _path2,
        grant: Page.GRANT_RESTRICTED,
      });
      const _page3 = await Page.findOne({
        path: _path3,
        grant: Page.GRANT_RESTRICTED,
      });
      expect(_pageD).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();

      const newPathForPage2 = '/np_rename7_destination/np_rename8';
      const newpathForPage3 = '/np_rename7_destination/np_rename8/np_rename9';
      await renamePage(
        _page2,
        newPathForPage2,
        npDummyUser1,
        { isRecursively: true },
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
          activityId: '62e291bc10e0ab61bd691794',
        },
      );

      const page2 = await Page.findOne({ path: _path2 }); // not exist
      const page3 = await Page.findOne({ path: _path3 }); // not renamed thus exist
      const page2Renamed = await Page.findOne({ path: newPathForPage2 }); // exist
      const page3Renamed = await Page.findOne({ path: newpathForPage3 }); // not exist
      expect(page2).toBeNull();
      expect(page3).toBeTruthy();
      expect(page2Renamed).toBeTruthy();
      expect(page3Renamed).toBeNull();
      expect(page2Renamed?.parent).toBeNull();
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
    });
  });
  describe('Duplicate', () => {
    const duplicate = async (
      page,
      newPagePath: string,
      user,
      isRecursively: boolean,
      onlyDuplicateUserRelatedResources: boolean,
    ) => {
      // mock return value
      const mockedDuplicateRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'duplicateRecursivelyMainOperation')
        .mockReturnValue(null);
      const duplicatedPage = await crowi.pageService.duplicate(
        page,
        newPagePath,
        user,
        isRecursively,
        onlyDuplicateUserRelatedResources,
      );

      // retrieve the arguments passed when calling method duplicateRecursivelyMainOperation inside duplicate method
      const argsForDuplicateRecursivelyMainOperation =
        mockedDuplicateRecursivelyMainOperation.mock.calls[0];

      // restores the original implementation
      mockedDuplicateRecursivelyMainOperation.mockRestore();

      // duplicate descendants
      if (page.grant !== Page.GRANT_RESTRICTED && isRecursively) {
        await crowi.pageService.duplicateRecursivelyMainOperation(
          ...(argsForDuplicateRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.duplicateRecursivelyMainOperation
          >),
        );
      }

      return duplicatedPage;
    };
    test('Duplicate single page with GRANT_RESTRICTED', async () => {
      const _page = await Page.findOne({
        path: '/np_duplicate1',
        grant: Page.GRANT_RESTRICTED,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _revision = _page?.revision;
      expect(_page).toBeTruthy();
      expect(_revision).toBeTruthy();

      const newPagePath = '/dup_np_duplicate1';
      await duplicate(_page, newPagePath, npDummyUser1, false, false);

      const duplicatedPage = await Page.findOne({ path: newPagePath });
      const duplicatedRevision = await Revision.findOne({
        pageId: duplicatedPage?._id,
      });
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage).toBeTruthy();
      expect(duplicatedPage?._id).not.toStrictEqual(_page?._id);
      expect(duplicatedPage?.grant).toBe(_page?.grant);
      expect(duplicatedPage?.parent).toBeNull();
      expect(duplicatedPage?.parent).toStrictEqual(_page?.parent);
      expect(duplicatedPage?.revision).toStrictEqual(duplicatedRevision?._id);
      expect(duplicatedRevision?.body).toBe(_revision?.body);
    });

    test('Should duplicate multiple pages with GRANT_USER_GROUP', async () => {
      const _path1 = '/np_duplicate2';
      const _path2 = '/np_duplicate2/np_duplicate3';
      const _page1 = await Page.findOne({
        path: _path1,
        parent: rootPage._id,
        grantedGroups: { $elemMatch: { item: groupIdA } },
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _page2 = await Page.findOne({
        path: _path2,
        parent: _page1?._id,
        grantedGroups: { $elemMatch: { item: groupIdB } },
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _revision1 = _page1?.revision;
      const _revision2 = _page2?.revision;
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_revision1).toBeTruthy();
      expect(_revision2).toBeTruthy();

      const newPagePath = '/dup_np_duplicate2';
      await duplicate(_page1, newPagePath, npDummyUser2, true, false);

      const duplicatedPage1 = await Page.findOne({
        path: newPagePath,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedPage2 = await Page.findOne({
        path: '/dup_np_duplicate2/np_duplicate3',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedRevision1 = duplicatedPage1?.revision;
      const duplicatedRevision2 = duplicatedPage2?.revision;
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage1).toBeTruthy();
      expect(duplicatedPage2).toBeTruthy();
      expect(duplicatedRevision1).toBeTruthy();
      expect(duplicatedRevision2).toBeTruthy();
      expect(
        normalizeGrantedGroups(duplicatedPage1?.grantedGroups),
      ).toStrictEqual([
        { item: groupIdA, type: GroupType.userGroup },
        { item: externalGroupIdA, type: GroupType.externalUserGroup },
      ]);
      expect(
        normalizeGrantedGroups(duplicatedPage2?.grantedGroups),
      ).toStrictEqual([
        { item: groupIdB, type: GroupType.userGroup },
        { item: externalGroupIdB, type: GroupType.externalUserGroup },
      ]);
      expect(duplicatedPage1?.parent).toStrictEqual(_page1?.parent);
      expect(duplicatedPage2?.parent).toStrictEqual(duplicatedPage1?._id);
      expect(duplicatedRevision1?.body).toBe(_revision1?.body);
      expect(duplicatedRevision2?.body).toBe(_revision2?.body);
      expect(duplicatedRevision1?.pageId).toStrictEqual(duplicatedPage1?._id);
      expect(duplicatedRevision2?.pageId).toStrictEqual(duplicatedPage2?._id);
    });
    test('Should duplicate multiple pages. Page with GRANT_RESTRICTED should NOT be duplicated', async () => {
      const _path1 = '/np_duplicate4';
      const _path2 = '/np_duplicate4/np_duplicate5';
      const _path3 = '/np_duplicate4/np_duplicate6';
      const _page1 = await Page.findOne({
        path: _path1,
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _page2 = await Page.findOne({
        path: _path2,
        grant: Page.GRANT_RESTRICTED,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _page3 = await Page.findOne({
        path: _path3,
        grant: Page.GRANT_PUBLIC,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const baseRevision1 = _page1?.revision;
      const baseRevision2 = _page2?.revision;
      const baseRevision3 = _page3?.revision;
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();
      expect(baseRevision1).toBeTruthy();
      expect(baseRevision2).toBeTruthy();

      const newPagePath = '/dup_np_duplicate4';
      await duplicate(_page1, newPagePath, npDummyUser1, true, false);

      const duplicatedPage1 = await Page.findOne({
        path: newPagePath,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedPage2 = await Page.findOne({
        path: '/dup_np_duplicate4/np_duplicate5',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedPage3 = await Page.findOne({
        path: '/dup_np_duplicate4/np_duplicate6',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedRevision1 = duplicatedPage1?.revision;
      const duplicatedRevision3 = duplicatedPage3?.revision;
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage1).toBeTruthy();
      expect(duplicatedPage2).toBeNull();
      expect(duplicatedPage3).toBeTruthy();
      expect(duplicatedRevision1).toBeTruthy();
      expect(duplicatedRevision3).toBeTruthy();
      expect(duplicatedPage1?.grant).toStrictEqual(Page.GRANT_PUBLIC);
      expect(duplicatedPage3?.grant).toStrictEqual(Page.GRANT_PUBLIC);
      expect(duplicatedPage1?.parent).toStrictEqual(_page1?.parent);
      expect(duplicatedPage3?.parent).toStrictEqual(duplicatedPage1?._id);
      expect(duplicatedRevision1?.body).toBe(baseRevision1?.body);
      expect(duplicatedRevision3?.body).toBe(baseRevision3?.body);
      expect(duplicatedRevision1?.pageId).toStrictEqual(duplicatedPage1?._id);
      expect(duplicatedRevision3?.pageId).toStrictEqual(duplicatedPage3?._id);
    });
    test('Should duplicate only user related pages and granted groups when onlyDuplicateUserRelatedResources is true', async () => {
      const _path1 = '/np_duplicate7';
      const _path2 = '/np_duplicate7/np_duplicate8';
      const _path3 = '/np_duplicate7/np_duplicate9';
      const _page1 = await Page.findOne({
        path: _path1,
        parent: rootPage._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _page2 = await Page.findOne({ path: _path2, parent: _page1?._id });
      const _page3 = await Page.findOne({ path: _path3, parent: _page1?._id });
      const _revision1 = _page1?.revision;
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();
      expect(_revision1).toBeTruthy();

      const newPagePath = '/dup_np_duplicate7';
      await duplicate(_page1, newPagePath, npDummyUser1, true, true);

      const duplicatedPage1 = await Page.findOne({
        path: newPagePath,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedPage2 = await Page.findOne({
        path: '/dup_np_duplicate7/np_duplicate8',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedPage3 = await Page.findOne({
        path: '/dup_np_duplicate7/np_duplicate9',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedRevision1 = duplicatedPage1?.revision;
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage1).toBeTruthy();
      expect(duplicatedPage2).toBeFalsy();
      expect(duplicatedPage3).toBeFalsy();
      expect(duplicatedRevision1).toBeTruthy();
      expect(
        normalizeGrantedGroups(duplicatedPage1?.grantedGroups),
      ).toStrictEqual([
        { item: groupIdA, type: GroupType.userGroup },
        { item: externalGroupIdA, type: GroupType.externalUserGroup },
      ]);
      expect(duplicatedPage1?.parent).toStrictEqual(_page1?.parent);
      expect(duplicatedRevision1?.body).toBe(_revision1?.body);
      expect(duplicatedRevision1?.pageId).toStrictEqual(duplicatedPage1?._id);
    });
    test('Should duplicate all pages and granted groups when onlyDuplicateUserRelatedResources is false', async () => {
      const _path1 = '/np_duplicate7';
      const _path2 = '/np_duplicate7/np_duplicate8';
      const _path3 = '/np_duplicate7/np_duplicate9';
      const _page1 = await Page.findOne({
        path: _path1,
        parent: rootPage._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _page2 = await Page.findOne({
        path: _path2,
        parent: _page1?._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _page3 = await Page.findOne({
        path: _path3,
        parent: _page1?._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const _revision1 = _page1?.revision;
      const _revision2 = _page2?.revision;
      const _revision3 = _page3?.revision;
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();
      expect(_revision1).toBeTruthy();
      expect(_revision2).toBeTruthy();
      expect(_revision3).toBeTruthy();

      const newPagePath = '/dup2_np_duplicate7';
      await duplicate(_page1, newPagePath, npDummyUser1, true, false);

      const duplicatedPage1 = await Page.findOne({
        path: newPagePath,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedPage2 = await Page.findOne({
        path: '/dup2_np_duplicate7/np_duplicate8',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedPage3 = await Page.findOne({
        path: '/dup2_np_duplicate7/np_duplicate9',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedRevision1 = duplicatedPage1?.revision;
      const duplicatedRevision2 = duplicatedPage2?.revision;
      const duplicatedRevision3 = duplicatedPage3?.revision;
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage1).toBeTruthy();
      expect(duplicatedPage2).toBeTruthy();
      expect(duplicatedPage3).toBeTruthy();
      expect(duplicatedRevision1).toBeTruthy();
      expect(duplicatedRevision2).toBeTruthy();
      expect(duplicatedRevision3).toBeTruthy();
      expect(
        normalizeGrantedGroups(duplicatedPage1?.grantedGroups),
      ).toStrictEqual([
        { item: groupIdA, type: GroupType.userGroup },
        { item: externalGroupIdA, type: GroupType.externalUserGroup },
        { item: groupIdB, type: GroupType.userGroup },
        { item: externalGroupIdB, type: GroupType.externalUserGroup },
      ]);
      expect(duplicatedPage1?.parent).toStrictEqual(_page1?.parent);
      expect(duplicatedRevision1?.body).toBe(_revision1?.body);
      expect(duplicatedRevision1?.pageId).toStrictEqual(duplicatedPage1?._id);
      expect(
        normalizeGrantedGroups(duplicatedPage2?.grantedGroups),
      ).toStrictEqual([
        { item: groupIdC, type: GroupType.userGroup },
        { item: externalGroupIdC, type: GroupType.externalUserGroup },
      ]);
      expect(duplicatedPage2?.parent).toStrictEqual(duplicatedPage1?._id);
      expect(duplicatedRevision2?.body).toBe(_revision2?.body);
      expect(duplicatedRevision2?.pageId).toStrictEqual(duplicatedPage2?._id);
      expect(duplicatedPage3?.grantedUsers).toStrictEqual([npDummyUser2?._id]);
      expect(duplicatedPage3?.parent).toStrictEqual(duplicatedPage1?._id);
      expect(duplicatedRevision3?.body).toBe(_revision3?.body);
      expect(duplicatedRevision3?.pageId).toStrictEqual(duplicatedPage3?._id);
    });
  });
  describe('Delete', () => {
    const deletePage = async (
      page,
      user,
      options,
      isRecursively,
      activityParameters?,
    ) => {
      const mockedDeleteRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'deleteRecursivelyMainOperation')
        .mockReturnValue(null);

      const deletedPage = await crowi.pageService.deletePage(
        page,
        user,
        options,
        isRecursively,
        activityParameters,
      );

      const argsForDeleteRecursivelyMainOperation =
        mockedDeleteRecursivelyMainOperation.mock.calls[0];

      mockedDeleteRecursivelyMainOperation.mockRestore();

      if (isRecursively) {
        await crowi.pageService.deleteRecursivelyMainOperation(
          ...(argsForDeleteRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.deleteRecursivelyMainOperation
          >),
        );
      }

      return deletedPage;
    };
    describe('Delete single page with grant RESTRICTED', () => {
      test('should be able to delete', async () => {
        const _pathT = '/npdel1_awl';
        const _pageT = await Page.findOne({
          path: _pathT,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(_pageT).toBeTruthy();

        const isRecursively = false;
        await deletePage(_pageT, dummyUser1, {}, isRecursively, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        });

        const pageT = await Page.findOne({ path: `/trash${_pathT}` });
        const pageN = await Page.findOne({ path: _pathT }); // should not exist
        expect(pageT).toBeTruthy();
        expect(pageN).toBeNull();
        expect(pageT?.grant).toBe(Page.GRANT_RESTRICTED);
        expect(pageT?.status).toBe(Page.STATUS_DELETED);
      });
    });
    describe('Delete single page with grant USER_GROUP', () => {
      test('should be able to delete', async () => {
        const _path = '/npdel2_ug';
        const _page1 = await Page.findOne({
          path: _path,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        });
        expect(_page1).toBeTruthy();

        const isRecursively = false;
        await deletePage(_page1, npDummyUser1, {}, isRecursively, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        });

        const pageN = await Page.findOne({
          path: _path,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        });
        const page1 = await Page.findOne({
          path: `/trash${_path}`,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        });
        expect(pageN).toBeNull();
        expect(page1).toBeTruthy();
        expect(page1?.status).toBe(Page.STATUS_DELETED);
        expect(page1?.descendantCount).toBe(0);
        expect(page1?.parent).toBeNull();
      });
    });
    describe('Delete multiple pages with grant USER_GROUP', () => {
      test('should be able to delete all descendants except page with GRANT_RESTRICTED', async () => {
        const _pathT = '/npdel3_top';
        const _path1 = '/npdel3_top/npdel4_ug';
        const _path2 = '/npdel3_top/npdel4_ug/npdel5_ug';
        const _pageT = await Page.findOne({
          path: _pathT,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        }); // A
        const _page1 = await Page.findOne({
          path: _path1,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdB } },
        }); // B
        const _page2 = await Page.findOne({
          path: _path2,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdC } },
        }); // C
        const _pageR = await Page.findOne({
          path: _path1,
          grant: Page.GRANT_RESTRICTED,
        }); // Restricted
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_pageR).toBeTruthy();

        const isRecursively = true;
        await deletePage(_pageT, npDummyUser1, {}, isRecursively, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        });

        const pageTNotExist = await Page.findOne({
          path: _pathT,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        }); // A should not exist
        const page1NotExist = await Page.findOne({
          path: _path1,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdB } },
        }); // B should not exist
        const page2NotExist = await Page.findOne({
          path: _path2,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdC } },
        }); // C should not exist
        const pageT = await Page.findOne({
          path: `/trash${_pathT}`,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        }); // A
        const page1 = await Page.findOne({
          path: `/trash${_path1}`,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdB } },
        }); // B
        const page2 = await Page.findOne({
          path: `/trash${_path2}`,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdC } },
        }); // C
        const pageR = await Page.findOne({
          path: _path1,
          grant: Page.GRANT_RESTRICTED,
        }); // Restricted
        expect(page1NotExist).toBeNull();
        expect(pageTNotExist).toBeNull();
        expect(page2NotExist).toBeNull();
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();
        expect(pageR).toBeTruthy();
        expect(pageT?.status).toBe(Page.STATUS_DELETED);
        expect(pageT?.status).toBe(Page.STATUS_DELETED);
        expect(page1?.status).toBe(Page.STATUS_DELETED);
        expect(page1?.descendantCount).toBe(0);
        expect(page2?.descendantCount).toBe(0);
        expect(page2?.descendantCount).toBe(0);
        expect(pageT?.parent).toBeNull();
        expect(page1?.parent).toBeNull();
        expect(page2?.parent).toBeNull();
      });
    });
  });
  describe('Delete completely', () => {
    const deleteCompletely = async (
      page,
      user,
      options = {},
      isRecursively = false,
      preventEmitting = false,
      activityParameters?,
    ) => {
      const mockedDeleteCompletelyRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'deleteCompletelyRecursivelyMainOperation')
        .mockReturnValue(null);

      await crowi.pageService.deleteCompletely(
        page,
        user,
        options,
        isRecursively,
        preventEmitting,
        activityParameters,
      );

      const argsForDeleteCompletelyRecursivelyMainOperation =
        mockedDeleteCompletelyRecursivelyMainOperation.mock.calls[0];

      mockedDeleteCompletelyRecursivelyMainOperation.mockRestore();

      if (isRecursively) {
        await crowi.pageService.deleteCompletelyRecursivelyMainOperation(
          ...(argsForDeleteCompletelyRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.deleteCompletelyRecursivelyMainOperation
          >),
        );
      }

      return;
    };

    describe('Delete single page with grant RESTRICTED', () => {
      test('should be able to delete completely', async () => {
        const _path = '/npdc1_awl';
        const _page = await Page.findOne({
          path: _path,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(_page).toBeTruthy();

        await deleteCompletely(_page, dummyUser1, {}, false, false, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        });

        const page = await Page.findOne({
          path: _path,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(page).toBeNull();
      });
    });
    describe('Delete single page with grant USER_GROUP', () => {
      test('should be able to delete completely', async () => {
        const _path = '/npdc2_ug';
        const _page = await Page.findOne({
          path: _path,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        });
        expect(_page).toBeTruthy();

        await deleteCompletely(_page, npDummyUser1, {}, false, false, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        });

        const page = await Page.findOne({
          path: _path,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        });
        expect(page).toBeNull();
      });
    });
    describe('Delete multiple pages with grant USER_GROUP', () => {
      test('should be able to delete all descendants completely except page with GRANT_RESTRICTED', async () => {
        const _path1 = '/npdc3_ug';
        const _path2 = '/npdc3_ug/npdc4_ug';
        const _path3 = '/npdc3_ug/npdc4_ug/npdc5_ug';
        const _page1 = await Page.findOne({
          path: _path1,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        });
        const _page2 = await Page.findOne({
          path: _path2,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdB } },
        });
        const _page3 = await Page.findOne({
          path: _path3,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdC } },
        });
        const _page4 = await Page.findOne({
          path: _path2,
          grant: Page.GRANT_RESTRICTED,
        });
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_page4).toBeTruthy();

        await deleteCompletely(_page1, npDummyUser1, {}, true, false, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        });

        const page1 = await Page.findOne({
          path: _path1,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdA } },
        });
        const page2 = await Page.findOne({
          path: _path2,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdB } },
        });
        const page3 = await Page.findOne({
          path: _path3,
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: { $elemMatch: { item: groupIdC } },
        });
        const page4 = await Page.findOne({
          path: _path2,
          grant: Page.GRANT_RESTRICTED,
        });

        expect(page1).toBeNull();
        expect(page2).toBeNull();
        expect(page3).toBeNull();
        expect(page4).toBeTruthy();
      });
    });
  });
  describe('revert', () => {
    const revertDeletedPage = async (
      page,
      user,
      options = {},
      isRecursively = false,
      activityParameters?,
    ) => {
      // mock return value
      const mockedRevertRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'revertRecursivelyMainOperation')
        .mockReturnValue(null);
      const revertedPage = await crowi.pageService.revertDeletedPage(
        page,
        user,
        options,
        isRecursively,
        activityParameters,
      );

      const argsForRecursivelyMainOperation =
        mockedRevertRecursivelyMainOperation.mock.calls[0];

      // restores the original implementation
      mockedRevertRecursivelyMainOperation.mockRestore();
      if (isRecursively) {
        await crowi.pageService.revertRecursivelyMainOperation(
          ...(argsForRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.revertRecursivelyMainOperation
          >),
        );
      }

      return revertedPage;
    };
    test('should revert single deleted page with GRANT_RESTRICTED', async () => {
      const trashedPage = await Page.findOne({
        path: '/trash/np_revert1',
        status: Page.STATUS_DELETED,
        grant: Page.GRANT_RESTRICTED,
      });
      const revision = await Revision.findOne({ pageId: trashedPage?._id });
      const tag = await Tag.findOne({ name: 'np_revertTag1' });
      const deletedPageTagRelation = await PageTagRelation.findOne({
        relatedPage: trashedPage?._id,
        relatedTag: tag?._id,
        isPageTrashed: true,
      });
      expect(trashedPage).toBeTruthy();
      expect(revision).toBeTruthy();
      expect(tag).toBeTruthy();
      expect(deletedPageTagRelation).toBeTruthy();

      await revertDeletedPage(trashedPage, dummyUser1, {}, false, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/rename',
      });

      const revertedPage = await Page.findOne({ path: '/np_revert1' });
      const deltedPageBeforeRevert = await Page.findOne({
        path: '/trash/np_revert1',
      });
      const pageTagRelation = await PageTagRelation.findOne<IPageTagRelation>({
        relatedPage: revertedPage?._id,
        relatedTag: tag?._id,
      });
      expect(revertedPage).toBeTruthy();
      expect(pageTagRelation).toBeTruthy();
      expect(deltedPageBeforeRevert).toBeNull();

      // page with GRANT_RESTRICTED does not have parent
      expect(revertedPage?.parent).toBeNull();
      expect(revertedPage?.status).toBe(Page.STATUS_PUBLISHED);
      expect(revertedPage?.grant).toBe(Page.GRANT_RESTRICTED);
      expect(pageTagRelation?.isPageTrashed).toBe(false);
    });
    test('should revert single deleted page with GRANT_USER_GROUP', async () => {
      const beforeRevertPath = '/trash/np_revert2';
      const user1 = await User.findOne({ name: 'npUser1' });
      const trashedPage = await Page.findOne({
        path: beforeRevertPath,
        status: Page.STATUS_DELETED,
        grant: Page.GRANT_USER_GROUP,
      });
      const revision = await Revision.findOne({ pageId: trashedPage?._id });
      const tag = await Tag.findOne({ name: 'np_revertTag2' });
      const deletedPageTagRelation = await PageTagRelation.findOne({
        relatedPage: trashedPage?._id,
        relatedTag: tag?._id,
        isPageTrashed: true,
      });
      expect(trashedPage).toBeTruthy();
      expect(revision).toBeTruthy();
      expect(tag).toBeTruthy();
      expect(deletedPageTagRelation).toBeTruthy();

      await revertDeletedPage(trashedPage, user1, {}, false, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/revert',
      });

      const revertedPage = await Page.findOne({ path: '/np_revert2' });
      const trashedPageBR = await Page.findOne({ path: beforeRevertPath });
      const pageTagRelation = await PageTagRelation.findOne<IPageTagRelation>({
        relatedPage: revertedPage?._id,
        relatedTag: tag?._id,
      });
      expect(revertedPage).toBeTruthy();
      expect(pageTagRelation).toBeTruthy();
      expect(trashedPageBR).toBeNull();

      expect(revertedPage?.parent).toStrictEqual(rootPage._id);
      expect(revertedPage?.status).toBe(Page.STATUS_PUBLISHED);
      expect(revertedPage?.grant).toBe(Page.GRANT_USER_GROUP);
      expect(normalizeGrantedGroups(revertedPage?.grantedGroups)).toStrictEqual(
        [
          { item: groupIdA, type: GroupType.userGroup },
          { item: externalGroupIdA, type: GroupType.externalUserGroup },
        ],
      );
      expect(pageTagRelation?.isPageTrashed).toBe(false);
    });
    test(`revert multiple pages: only target page should be reverted.
          Non-existant middle page and leaf page with GRANT_RESTRICTED shoud not be reverted`, async () => {
      const beforeRevertPath1 = '/trash/np_revert3';
      const beforeRevertPath2 = '/trash/np_revert3/middle/np_revert4';
      const trashedPage1 = await Page.findOne({
        path: beforeRevertPath1,
        status: Page.STATUS_DELETED,
        grant: Page.GRANT_PUBLIC,
      });
      const trashedPage2 = await Page.findOne({
        path: beforeRevertPath2,
        status: Page.STATUS_DELETED,
        grant: Page.GRANT_RESTRICTED,
      });
      const revision1 = await Revision.findOne({ pageId: trashedPage1?._id });
      const revision2 = await Revision.findOne({ pageId: trashedPage2?._id });
      expect(trashedPage1).toBeTruthy();
      expect(trashedPage2).toBeTruthy();
      expect(revision1).toBeTruthy();
      expect(revision2).toBeTruthy();

      await revertDeletedPage(trashedPage1, npDummyUser2, {}, true, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/revert',
      });

      const revertedPage = await Page.findOne({ path: '/np_revert3' });
      const middlePage = await Page.findOne({ path: '/np_revert3/middle' });
      const notRestrictedPage = await Page.findOne({
        path: '/np_revert3/middle/np_revert4',
      });
      // AR => After Revert
      const trashedPage1AR = await Page.findOne({ path: beforeRevertPath1 });
      const trashedPage2AR = await Page.findOne({ path: beforeRevertPath2 });
      const revision1AR = await Revision.findOne({ pageId: revertedPage?._id });
      const revision2AR = await Revision.findOne({
        pageId: trashedPage2AR?._id,
      });

      expect(revertedPage).toBeTruthy();
      expect(trashedPage2AR).toBeTruthy();
      expect(revision1AR).toBeTruthy();
      expect(revision2AR).toBeTruthy();
      expect(trashedPage1AR).toBeNull();
      expect(notRestrictedPage).toBeNull();
      expect(middlePage).toBeNull();
      expect(revertedPage?.parent).toStrictEqual(rootPage._id);
      expect(revertedPage?.status).toBe(Page.STATUS_PUBLISHED);
      expect(revertedPage?.grant).toBe(Page.GRANT_PUBLIC);
    });
    test('revert multiple pages: target page, initially non-existant page and leaf page with GRANT_USER_GROUP shoud be reverted', async () => {
      const user = await User.findOne({ _id: npDummyUser3 });
      const beforeRevertPath1 = '/trash/np_revert5';
      const beforeRevertPath2 = '/trash/np_revert5/middle/np_revert6';
      const beforeRevertPath3 = '/trash/np_revert5/middle';
      const trashedPage1 = await Page.findOne({
        path: beforeRevertPath1,
        status: Page.STATUS_DELETED,
        grantedGroups: { $elemMatch: { item: groupIdA } },
      });
      const trashedPage2 = await Page.findOne({
        path: beforeRevertPath2,
        status: Page.STATUS_DELETED,
        grantedGroups: { $elemMatch: { item: groupIdB } },
      });
      const nonExistantPage3 = await Page.findOne({ path: beforeRevertPath3 }); // not exist
      const revision1 = await Revision.findOne({ pageId: trashedPage1?._id });
      const revision2 = await Revision.findOne({ pageId: trashedPage2?._id });
      expect(trashedPage1).toBeTruthy();
      expect(trashedPage2).toBeTruthy();
      expect(revision1).toBeTruthy();
      expect(revision2).toBeTruthy();
      expect(user).toBeTruthy();
      expect(nonExistantPage3).toBeNull();

      await revertDeletedPage(trashedPage1, user, {}, true, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/revert',
      });
      const revertedPage1 = await Page.findOne({ path: '/np_revert5' });
      const newlyCreatedPage = await Page.findOne({
        path: '/np_revert5/middle',
      });
      const revertedPage2 = await Page.findOne({
        path: '/np_revert5/middle/np_revert6',
      });

      // // AR => After Revert
      const trashedPage1AR = await Page.findOne({ path: beforeRevertPath1 });
      const trashedPage2AR = await Page.findOne({ path: beforeRevertPath2 });
      expect(revertedPage1).toBeTruthy();
      expect(newlyCreatedPage).toBeTruthy();
      expect(revertedPage2).toBeTruthy();
      expect(trashedPage1AR).toBeNull();
      expect(trashedPage2AR).toBeNull();

      expect(newlyCreatedPage?.isEmpty).toBe(true);
      expect(revertedPage1?.parent).toStrictEqual(rootPage._id);
      expect(revertedPage2?.parent).toStrictEqual(newlyCreatedPage?._id);
      expect(newlyCreatedPage?.parent).toStrictEqual(revertedPage1?._id);
      expect(revertedPage1?.status).toBe(Page.STATUS_PUBLISHED);
      expect(revertedPage2?.status).toBe(Page.STATUS_PUBLISHED);
      expect(newlyCreatedPage?.status).toBe(Page.STATUS_PUBLISHED);
      expect(
        normalizeGrantedGroups(revertedPage1?.grantedGroups),
      ).toStrictEqual([
        { item: groupIdA, type: GroupType.userGroup },
        { item: externalGroupIdA, type: GroupType.externalUserGroup },
      ]);
      expect(
        normalizeGrantedGroups(revertedPage2?.grantedGroups),
      ).toStrictEqual([
        { item: groupIdB, type: GroupType.userGroup },
        { item: externalGroupIdB, type: GroupType.externalUserGroup },
      ]);
      expect(newlyCreatedPage?.grant).toBe(Page.GRANT_PUBLIC);
    });
  });
});
