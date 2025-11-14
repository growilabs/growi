import { configManager } from '~/server/service/config-manager';

import { KeycloakUserGroupSyncService } from './keycloak-user-group-sync';

vi.mock('@keycloak/keycloak-admin-client', () => {
  return {
    default: class {
      auth() {}

      groups = {
        // mock group search on Keycloak
        find: () => {
          return [
            // root node
            {
              id: 'groupId1',
              name: 'grandParentGroup',
              subGroups: [
                {
                  id: 'groupId2',
                  name: 'parentGroup',
                  subGroups: [
                    {
                      id: 'groupId3',
                      name: 'childGroup',
                    },
                  ],
                },
              ],
            },
            // another root node
            {
              id: 'groupId4',
              name: 'rootGroup',
            },
          ];
        },

        // mock group detail
        findOne: (payload) => {
          if (payload?.id === 'groupId1') {
            return Promise.resolve({
              id: 'groupId1',
              name: 'grandParentGroup',
              attributes: {
                description: ['this is a grand parent group'],
              },
            });
          }
          if (payload?.id === 'groupId2') {
            return Promise.resolve({
              id: 'groupId2',
              name: 'parentGroup',
              attributes: {
                description: ['this is a parent group'],
              },
            });
          }
          if (payload?.id === 'groupId3') {
            return Promise.resolve({
              id: 'groupId3',
              name: 'childGroup',
              attributes: {
                description: ['this is a child group'],
              },
            });
          }
          if (payload?.id === 'groupId4') {
            return Promise.resolve({
              id: 'groupId3',
              name: 'childGroup',
              attributes: {
                description: ['this is a root group'],
              },
            });
          }
          return Promise.reject(new Error('not found'));
        },

        // mock group users
        listMembers: (payload) => {
          // set 'first' condition to 0 (the first member request to server) or else it will result in infinite loop
          if (payload?.id === 'groupId1' && payload?.first === 0) {
            return Promise.resolve([
              {
                id: 'userId1',
                username: 'grandParentGroupUser',
                email: 'user@grandParentGroup.com',
              },
            ]);
          }
          if (payload?.id === 'groupId2' && payload?.first === 0) {
            return Promise.resolve([
              {
                id: 'userId2',
                username: 'parentGroupUser',
                email: 'user@parentGroup.com',
              },
            ]);
          }
          if (payload?.id === 'groupId3' && payload?.first === 0) {
            return Promise.resolve([
              {
                id: 'userId3',
                username: 'childGroupUser',
                email: 'user@childGroup.com',
              },
            ]);
          }
          if (payload?.id === 'groupId4' && payload?.first === 0) {
            return Promise.resolve([
              {
                id: 'userId4',
                username: 'rootGroupUser',
                email: 'user@rootGroup.com',
              },
            ]);
          }
          return Promise.resolve([]);
        },
      };
    },
  };
});

describe('KeycloakUserGroupSyncService.generateExternalUserGroupTrees', () => {
  let keycloakUserGroupSyncService: KeycloakUserGroupSyncService;

  const configParams = {
    'external-user-group:keycloak:host': 'http://dummy-keycloak-host.com',
    'external-user-group:keycloak:groupRealm': 'myrealm',
    'external-user-group:keycloak:groupSyncClientRealm': 'myrealm',
    'external-user-group:keycloak:groupDescriptionAttribute': 'description',
    'external-user-group:keycloak:groupSyncClientID': 'admin-cli',
    'external-user-group:keycloak:groupSyncClientSecret': '123456',
  };

  beforeAll(async () => {
    await configManager.loadConfigs();
    await configManager.updateConfigs(configParams, { skipPubsub: true });
    keycloakUserGroupSyncService = new KeycloakUserGroupSyncService(null, null);
    keycloakUserGroupSyncService.init('oidc');
  });

  it('creates ExternalUserGroupTrees', async () => {
    const rootNodes =
      await keycloakUserGroupSyncService?.generateExternalUserGroupTrees();

    expect(rootNodes?.length).toBe(2);

    // check grandParentGroup
    const grandParentNode = rootNodes?.find((node) => node.id === 'groupId1');
    const expectedChildNode = {
      id: 'groupId3',
      userInfos: [
        {
          id: 'userId3',
          username: 'childGroupUser',
          email: 'user@childGroup.com',
        },
      ],
      childGroupNodes: [],
      name: 'childGroup',
      description: 'this is a child group',
    };
    const expectedParentNode = {
      id: 'groupId2',
      userInfos: [
        {
          id: 'userId2',
          username: 'parentGroupUser',
          email: 'user@parentGroup.com',
        },
      ],
      childGroupNodes: [expectedChildNode],
      name: 'parentGroup',
      description: 'this is a parent group',
    };
    const expectedGrandParentNode = {
      id: 'groupId1',
      userInfos: [
        {
          id: 'userId1',
          username: 'grandParentGroupUser',
          email: 'user@grandParentGroup.com',
        },
      ],
      childGroupNodes: [expectedParentNode],
      name: 'grandParentGroup',
      description: 'this is a grand parent group',
    };
    expect(grandParentNode).toStrictEqual(expectedGrandParentNode);

    // check rootGroup
    const rootNode = rootNodes?.find((node) => node.id === 'groupId4');
    const expectedRootNode = {
      id: 'groupId4',
      userInfos: [
        {
          id: 'userId4',
          username: 'rootGroupUser',
          email: 'user@rootGroup.com',
        },
      ],
      childGroupNodes: [],
      name: 'rootGroup',
      description: 'this is a root group',
    };
    expect(rootNode).toStrictEqual(expectedRootNode);
  });
});
