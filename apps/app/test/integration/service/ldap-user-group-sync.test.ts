import ldap, { type Client } from 'ldapjs';

import { LdapUserGroupSyncService } from '../../../src/features/external-user-group/server/service/ldap-user-group-sync';
import type Crowi from '../../../src/server/crowi';
import { configManager } from '../../../src/server/service/config-manager';
import { ldapService } from '../../../src/server/service/ldap';
import PassportService from '../../../src/server/service/passport';
import { getInstance } from '../setup-crowi';

describe('LdapUserGroupSyncService.generateExternalUserGroupTrees', () => {
  let crowi: Crowi;
  let ldapUserGroupSyncService: LdapUserGroupSyncService;

  const configParams = {
    'security:passport-ldap:attrMapName': 'name',
    'external-user-group:ldap:groupChildGroupAttribute': 'member',
    'external-user-group:ldap:groupMembershipAttribute': 'member',
    'external-user-group:ldap:groupNameAttribute': 'cn',
    'external-user-group:ldap:groupDescriptionAttribute': 'description',
    'external-user-group:ldap:groupMembershipAttributeType': 'DN',
    'external-user-group:ldap:groupSearchBase': 'ou=groups,dc=example,dc=org',
    'security:passport-ldap:serverUrl':
      'ldap://openldap:1389/dc=example,dc=org',
  };

  jest.mock('../../../src/server/service/ldap');
  const mockBind = jest.spyOn(ldapService, 'bind');
  const mockLdapSearch = jest.spyOn(ldapService, 'search');
  const mockLdapCreateClient = jest.spyOn(ldap, 'createClient');

  beforeAll(async () => {
    crowi = await getInstance();
    await configManager.updateConfigs(configParams, { skipPubsub: true });

    mockBind.mockImplementation(() => {
      return Promise.resolve();
    });
    mockLdapCreateClient.mockImplementation(() => {
      return {} as Client;
    });

    const passportService = new PassportService(crowi);
    ldapUserGroupSyncService = new LdapUserGroupSyncService(
      passportService,
      null,
      null,
    );
  });

  describe('When there is no circular reference in group tree', () => {
    it('creates ExternalUserGroupTrees', async () => {
      // mock search on LDAP server
      mockLdapSearch.mockImplementation((filter, base) => {
        if (base === 'ou=groups,dc=example,dc=org') {
          // search groups
          return Promise.resolve([
            {
              objectName: 'cn=childGroup,ou=groups,dc=example,dc=org',
              attributes: [
                { type: 'cn', values: ['childGroup'] },
                { type: 'description', values: ['this is a child group'] },
                {
                  type: 'member',
                  values: ['cn=childGroupUser,ou=users,dc=example,dc=org'],
                },
              ],
            },
            {
              objectName: 'cn=parentGroup,ou=groups,dc=example,dc=org',
              attributes: [
                { type: 'cn', values: ['parentGroup'] },
                { type: 'description', values: ['this is a parent group'] },
                {
                  type: 'member',
                  values: [
                    'cn=childGroup,ou=groups,dc=example,dc=org',
                    'cn=parentGroupUser,ou=users,dc=example,dc=org',
                  ],
                },
              ],
            },
            // root node
            {
              objectName: 'cn=grandParentGroup,ou=groups,dc=example,dc=org',
              attributes: [
                { type: 'cn', values: ['grandParentGroup'] },
                {
                  type: 'description',
                  values: ['this is a grand parent group'],
                },
                {
                  type: 'member',
                  values: [
                    'cn=parentGroup,ou=groups,dc=example,dc=org',
                    'cn=grandParentGroupUser,ou=users,dc=example,dc=org',
                  ],
                },
              ],
            },
            // another root node
            {
              objectName: 'cn=rootGroup,ou=groups,dc=example,dc=org',
              attributes: [
                { type: 'cn', values: ['rootGroup'] },
                { type: 'description', values: ['this is a root group'] },
                {
                  type: 'member',
                  values: ['cn=rootGroupUser,ou=users,dc=example,dc=org'],
                },
              ],
            },
          ]);
        }
        if (base === 'cn=childGroupUser,ou=users,dc=example,dc=org') {
          // search childGroupUser
          return Promise.resolve([
            {
              objectName: 'cn=childGroupUser,ou=users,dc=example,dc=org',
              attributes: [
                { type: 'name', values: ['Child Group User'] },
                { type: 'uid', values: ['childGroupUser'] },
                { type: 'mail', values: ['user@childGroup.com'] },
              ],
            },
          ]);
        }
        // search parentGroupUser
        if (base === 'cn=parentGroupUser,ou=users,dc=example,dc=org') {
          return Promise.resolve([
            {
              objectName: 'cn=parentGroupUser,ou=users,dc=example,dc=org',
              attributes: [
                { type: 'name', values: ['Parent Group User'] },
                { type: 'uid', values: ['parentGroupUser'] },
                { type: 'mail', values: ['user@parentGroup.com'] },
              ],
            },
          ]);
        }
        // search grandParentGroupUser
        if (base === 'cn=grandParentGroupUser,ou=users,dc=example,dc=org') {
          return Promise.resolve([
            {
              objectName: 'cn=grandParentGroupUser,ou=users,dc=example,dc=org',
              attributes: [
                { type: 'name', values: ['Grand Parent Group User'] },
                { type: 'uid', values: ['grandParentGroupUser'] },
                { type: 'mail', values: ['user@grandParentGroup.com'] },
              ],
            },
          ]);
        }
        // search rootGroupUser
        if (base === 'cn=rootGroupUser,ou=users,dc=example,dc=org') {
          return Promise.resolve([
            {
              objectName: 'cn=rootGroupUser,ou=users,dc=example,dc=org',
              attributes: [
                { type: 'name', values: ['Root Group User'] },
                { type: 'uid', values: ['rootGroupUser'] },
                { type: 'mail', values: ['user@rootGroup.com'] },
              ],
            },
          ]);
        }
        return Promise.reject(new Error('not found'));
      });

      const rootNodes =
        await ldapUserGroupSyncService?.generateExternalUserGroupTrees();

      expect(rootNodes?.length).toBe(2);

      // check grandParentGroup
      const grandParentNode = rootNodes?.find(
        (node) => node.id === 'cn=grandParentGroup,ou=groups,dc=example,dc=org',
      );
      const expectedChildNode = {
        id: 'cn=childGroup,ou=groups,dc=example,dc=org',
        userInfos: [
          {
            id: 'childGroupUser',
            username: 'childGroupUser',
            name: 'Child Group User',
            email: 'user@childGroup.com',
          },
        ],
        childGroupNodes: [],
        name: 'childGroup',
        description: 'this is a child group',
      };
      const expectedParentNode = {
        id: 'cn=parentGroup,ou=groups,dc=example,dc=org',
        userInfos: [
          {
            id: 'parentGroupUser',
            username: 'parentGroupUser',
            name: 'Parent Group User',
            email: 'user@parentGroup.com',
          },
        ],
        childGroupNodes: [expectedChildNode],
        name: 'parentGroup',
        description: 'this is a parent group',
      };
      const expectedGrandParentNode = {
        id: 'cn=grandParentGroup,ou=groups,dc=example,dc=org',
        userInfos: [
          {
            id: 'grandParentGroupUser',
            username: 'grandParentGroupUser',
            name: 'Grand Parent Group User',
            email: 'user@grandParentGroup.com',
          },
        ],
        childGroupNodes: [expectedParentNode],
        name: 'grandParentGroup',
        description: 'this is a grand parent group',
      };
      expect(grandParentNode).toStrictEqual(expectedGrandParentNode);

      // check rootGroup
      const rootNode = rootNodes?.find(
        (node) => node.id === 'cn=rootGroup,ou=groups,dc=example,dc=org',
      );
      const expectedRootNode = {
        id: 'cn=rootGroup,ou=groups,dc=example,dc=org',
        userInfos: [
          {
            id: 'rootGroupUser',
            username: 'rootGroupUser',
            name: 'Root Group User',
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

  describe('When there is a circular reference in group tree', () => {
    it('rejects creating ExternalUserGroupTrees', async () => {
      // mock search on LDAP server
      mockLdapSearch.mockImplementation((filter, base) => {
        if (base === 'ou=groups,dc=example,dc=org') {
          // search groups
          return Promise.resolve([
            // childGroup and parentGroup have circular reference
            {
              objectName: 'cn=childGroup,ou=groups,dc=example,dc=org',
              attributes: [
                { type: 'cn', values: ['childGroup'] },
                { type: 'description', values: ['this is a child group'] },
                {
                  type: 'member',
                  values: ['cn=parentGroup,ou=groups,dc=example,dc=org'],
                },
              ],
            },
            {
              objectName: 'cn=parentGroup,ou=groups,dc=example,dc=org',
              attributes: [
                { type: 'cn', values: ['parentGroup'] },
                { type: 'description', values: ['this is a parent group'] },
                {
                  type: 'member',
                  values: ['cn=childGroup,ou=groups,dc=example,dc=org'],
                },
              ],
            },
            {
              objectName: 'cn=grandParentGroup,ou=groups,dc=example,dc=org',
              attributes: [
                { type: 'cn', values: ['grandParentGroup'] },
                {
                  type: 'description',
                  values: ['this is a grand parent group'],
                },
                {
                  type: 'member',
                  values: ['cn=parentGroup,ou=groups,dc=example,dc=org'],
                },
              ],
            },
          ]);
        }
        return Promise.reject(new Error('not found'));
      });

      await expect(
        ldapUserGroupSyncService?.generateExternalUserGroupTrees(),
      ).rejects.toThrow('Circular reference inside LDAP group tree');
    });
  });
});
