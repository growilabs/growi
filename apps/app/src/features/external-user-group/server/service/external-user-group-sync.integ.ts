import type { IPage, IUserHasId } from '@growi/core';
import mongoose, { Types } from 'mongoose';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import ExternalAccount from '~/server/models/external-account';
import type { PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import instanciateExternalAccountService from '~/server/service/external-account';
import type PassportService from '~/server/service/passport';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

import type {
  ExternalUserGroupTreeNode,
  IExternalUserGroup,
  IExternalUserGroupHasId,
} from '../../interfaces/external-user-group';
import { ExternalGroupProviderType } from '../../interfaces/external-user-group';
import ExternalUserGroup from '../models/external-user-group';
import ExternalUserGroupRelation from '../models/external-user-group-relation';
import ExternalUserGroupSyncService from './external-user-group-sync';

// dummy class to implement generateExternalUserGroupTrees which returns test data
class TestExternalUserGroupSyncService extends ExternalUserGroupSyncService {
  constructor(s2sMessagingService, socketIoService) {
    super('ldap', s2sMessagingService, socketIoService);
    this.authProviderType = ExternalGroupProviderType.ldap;
  }

  async generateExternalUserGroupTrees(): Promise<ExternalUserGroupTreeNode[]> {
    const childNode: ExternalUserGroupTreeNode = {
      id: 'cn=childGroup,ou=groups,dc=example,dc=org',
      userInfos: [
        {
          id: 'childGroupUser',
          username: 'childGroupUser',
          name: 'Child Group User',
          email: 'user@childgroup.com',
        },
      ],
      childGroupNodes: [],
      name: 'childGroup',
      description: 'this is a child group',
    };
    const parentNode: ExternalUserGroupTreeNode = {
      id: 'cn=parentGroup,ou=groups,dc=example,dc=org',
      userInfos: [
        {
          id: 'parentGroupUser',
          username: 'parentGroupUser',
          email: 'user@parentgroup.com',
        },
      ],
      childGroupNodes: [childNode],
      name: 'parentGroup',
      description: 'this is a parent group',
    };
    const grandParentNode: ExternalUserGroupTreeNode = {
      id: 'cn=grandParentGroup,ou=groups,dc=example,dc=org',
      userInfos: [
        {
          id: 'grandParentGroupUser',
          username: 'grandParentGroupUser',
          name: 'Grand Parent Group User',
        },
      ],
      childGroupNodes: [parentNode],
      name: 'grandParentGroup',
      description: 'this is a grand parent group',
    };

    const previouslySyncedNode: ExternalUserGroupTreeNode = {
      id: 'cn=previouslySyncedGroup,ou=groups,dc=example,dc=org',
      userInfos: [
        {
          id: 'previouslySyncedGroupUser',
          username: 'previouslySyncedGroupUser',
          name: 'Root Group User',
          email: 'user@previouslySyncedgroup.com',
        },
      ],
      childGroupNodes: [],
      name: 'previouslySyncedGroup',
      description: 'this is a previouslySynced group',
    };

    return [grandParentNode, previouslySyncedNode];
  }
}

const checkGroup = (
  group: IExternalUserGroupHasId,
  expected: Omit<IExternalUserGroup, 'createdAt'>,
) => {
  const actual = {
    name: group.name,
    parent: group.parent,
    description: group.description,
    externalId: group.externalId,
    provider: group.provider,
  };
  expect(actual).toStrictEqual(expected);
};

const checkSync = async (autoGenerateUserOnGroupSync = true) => {
  const grandParentGroup = await ExternalUserGroup.findOne({
    name: 'grandParentGroup',
  });
  expect(grandParentGroup).not.toBeNull();
  checkGroup(grandParentGroup!, {
    externalId: 'cn=grandParentGroup,ou=groups,dc=example,dc=org',
    name: 'grandParentGroup',
    description: 'this is a grand parent group',
    provider: 'ldap',
    parent: null,
  });

  const parentGroup = await ExternalUserGroup.findOne({ name: 'parentGroup' });
  expect(parentGroup).not.toBeNull();
  checkGroup(parentGroup!, {
    externalId: 'cn=parentGroup,ou=groups,dc=example,dc=org',
    name: 'parentGroup',
    description: 'this is a parent group',
    provider: 'ldap',
    parent: grandParentGroup!._id,
  });

  const childGroup = await ExternalUserGroup.findOne({ name: 'childGroup' });
  expect(childGroup).not.toBeNull();
  checkGroup(childGroup!, {
    externalId: 'cn=childGroup,ou=groups,dc=example,dc=org',
    name: 'childGroup',
    description: 'this is a child group',
    provider: 'ldap',
    parent: parentGroup!._id,
  });

  const previouslySyncedGroup = await ExternalUserGroup.findOne({
    name: 'previouslySyncedGroup',
  });
  expect(previouslySyncedGroup).not.toBeNull();
  checkGroup(previouslySyncedGroup!, {
    externalId: 'cn=previouslySyncedGroup,ou=groups,dc=example,dc=org',
    name: 'previouslySyncedGroup',
    description: 'this is a previouslySynced group',
    provider: 'ldap',
    parent: null,
  });

  const grandParentGroupRelations = await ExternalUserGroupRelation.find({
    relatedGroup: grandParentGroup!._id,
  });
  const parentGroupRelations = await ExternalUserGroupRelation.find({
    relatedGroup: parentGroup!._id,
  });
  const childGroupRelations = await ExternalUserGroupRelation.find({
    relatedGroup: childGroup!._id,
  });
  const previouslySyncedGroupRelations = await ExternalUserGroupRelation.find({
    relatedGroup: previouslySyncedGroup!._id,
  });

  if (autoGenerateUserOnGroupSync) {
    expect(grandParentGroupRelations.length).toBe(3);
    const populatedGrandParentGroupRelations = await Promise.all(
      grandParentGroupRelations.map((relation) => {
        return relation.populate<{ relatedUser: IUserHasId }>('relatedUser');
      }),
    );
    expect(populatedGrandParentGroupRelations[0].relatedUser.username).toBe(
      'grandParentGroupUser',
    );
    expect(populatedGrandParentGroupRelations[1].relatedUser.username).toBe(
      'parentGroupUser',
    );
    expect(populatedGrandParentGroupRelations[2].relatedUser.username).toBe(
      'childGroupUser',
    );

    expect(parentGroupRelations.length).toBe(2);
    const populatedParentGroupRelations = await Promise.all(
      parentGroupRelations.map((relation) => {
        return relation.populate<{ relatedUser: IUserHasId }>('relatedUser');
      }),
    );
    expect(populatedParentGroupRelations[0].relatedUser.username).toBe(
      'parentGroupUser',
    );
    expect(populatedParentGroupRelations[1].relatedUser.username).toBe(
      'childGroupUser',
    );

    expect(childGroupRelations.length).toBe(1);
    const childGroupUser = (
      await childGroupRelations[0].populate<{ relatedUser: IUserHasId }>(
        'relatedUser',
      )
    )?.relatedUser;
    expect(childGroupUser?.username).toBe('childGroupUser');

    expect(previouslySyncedGroupRelations.length).toBe(1);
    const previouslySyncedGroupUser = (
      await previouslySyncedGroupRelations[0].populate<{
        relatedUser: IUserHasId;
      }>('relatedUser')
    )?.relatedUser;
    expect(previouslySyncedGroupUser?.username).toBe(
      'previouslySyncedGroupUser',
    );

    const userPages = await mongoose.model<IPage>('Page').find({
      path: {
        $in: [
          '/user/childGroupUser',
          '/user/parentGroupUser',
          '/user/grandParentGroupUser',
          '/user/previouslySyncedGroupUser',
        ],
      },
    });
    expect(userPages.length).toBe(4);
  } else {
    expect(grandParentGroupRelations.length).toBe(0);
    expect(parentGroupRelations.length).toBe(0);
    expect(childGroupRelations.length).toBe(0);
    expect(previouslySyncedGroupRelations.length).toBe(0);
  }
};

describe('ExternalUserGroupSyncService.syncExternalUserGroups', () => {
  let testService: TestExternalUserGroupSyncService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Page: PageModel;
  let rootPageId: Types.ObjectId;
  let userPageId: Types.ObjectId;

  beforeAll(async () => {
    // Initialize configManager
    const s2sMessagingServiceMock = mock<S2sMessagingService>();
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
    await configManager.loadConfigs();

    const crowi: Crowi = await getInstance();

    // Initialize models with crowi mock
    const pageModule = await import('~/server/models/page');
    Page = pageModule.default(crowi);

    const userModule = await import('~/server/models/user/index');
    userModule.default(crowi);

    // Initialize services with mocked PassportService
    await configManager.updateConfig('app:isV5Compatible', true);

    // Create PassportService mock with required methods for externalAccountService
    const passportServiceMock = mock<PassportService>({
      isSameUsernameTreatedAsIdenticalUser: vi.fn().mockReturnValue(false),
      isSameEmailTreatedAsIdenticalUser: vi.fn().mockReturnValue(false),
    });
    instanciateExternalAccountService(passportServiceMock);

    // Create root page and /user page for UserEvent.onActivated to work
    rootPageId = new Types.ObjectId();
    userPageId = new Types.ObjectId();

    // Check if root page already exists
    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      await Page.insertMany([
        {
          _id: rootPageId,
          path: '/',
          grant: Page.GRANT_PUBLIC,
        },
      ]);
    } else {
      rootPageId = existingRootPage._id;
    }

    // Check if /user page already exists
    const existingUserPage = await Page.findOne({ path: '/user' });
    if (existingUserPage == null) {
      await Page.insertMany([
        {
          _id: userPageId,
          path: '/user',
          grant: Page.GRANT_PUBLIC,
          parent: rootPageId,
          isEmpty: true,
        },
      ]);
    } else {
      userPageId = existingUserPage._id;
    }
  });

  beforeEach(async () => {
    // Create new testService instance for each test to reset syncStatus
    testService = new TestExternalUserGroupSyncService(null, null);

    await ExternalUserGroup.create({
      name: 'nameBeforeEdit',
      description: 'this is a description before edit',
      externalId: 'cn=previouslySyncedGroup,ou=groups,dc=example,dc=org',
      provider: 'ldap',
    });
  });

  afterEach(async () => {
    await ExternalUserGroup.deleteMany();
    await ExternalUserGroupRelation.deleteMany();
    await mongoose.model('User').deleteMany({
      username: {
        $in: [
          'childGroupUser',
          'parentGroupUser',
          'grandParentGroupUser',
          'previouslySyncedGroupUser',
        ],
      },
    });
    await ExternalAccount.deleteMany({
      accountId: {
        $in: [
          'childGroupUser',
          'parentGroupUser',
          'grandParentGroupUser',
          'previouslySyncedGroupUser',
        ],
      },
    });
    await mongoose.model('Page').deleteMany({
      path: {
        $in: [
          '/user/childGroupUser',
          '/user/parentGroupUser',
          '/user/grandParentGroupUser',
          '/user/previouslySyncedGroupUser',
        ],
      },
    });
  });

  describe('When autoGenerateUserOnGroupSync is true', () => {
    const configParams = {
      'external-user-group:ldap:autoGenerateUserOnGroupSync': true,
      'external-user-group:ldap:preserveDeletedGroups': false,
    };

    beforeEach(async () => {
      await configManager.updateConfigs(configParams);
    });

    it('syncs groups with new users', async () => {
      await testService.syncExternalUserGroups();
      await checkSync();
    });
  });

  describe('When autoGenerateUserOnGroupSync is false', () => {
    const configParams = {
      'external-user-group:ldap:autoGenerateUserOnGroupSync': false,
      'external-user-group:ldap:preserveDeletedGroups': true,
    };

    beforeEach(async () => {
      await configManager.updateConfigs(configParams);
    });

    it('syncs groups without new users', async () => {
      await testService.syncExternalUserGroups();
      await checkSync(false);
    });
  });

  describe('When preserveDeletedGroups is false', () => {
    const configParams = {
      'external-user-group:ldap:autoGenerateUserOnGroupSync': true,
      'external-user-group:ldap:preserveDeletedGroups': false,
    };

    beforeEach(async () => {
      await configManager.updateConfigs(configParams);

      const groupId = new Types.ObjectId();
      const userId = new Types.ObjectId();

      await ExternalUserGroup.create({
        _id: groupId,
        name: 'non existent group',
        externalId: 'cn=nonExistentGroup,ou=groups,dc=example,dc=org',
        provider: 'ldap',
      });
      await mongoose
        .model('User')
        .create({ _id: userId, username: 'nonExistentGroupUser' });
      await ExternalUserGroupRelation.create({
        relatedUser: userId,
        relatedGroup: groupId,
      });
    });

    it('syncs groups and deletes groups that do not exist externally', async () => {
      await testService.syncExternalUserGroups();
      await checkSync();
      expect(await ExternalUserGroup.countDocuments()).toBe(4);
      expect(await ExternalUserGroupRelation.countDocuments()).toBe(7);
    });
  });
});
