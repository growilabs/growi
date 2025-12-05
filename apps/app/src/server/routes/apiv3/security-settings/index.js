import {
  ConfigSource,
  SCOPE,
  toNonBlankStringOrUndefined,
} from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import xss from 'xss';

import { SupportedAction } from '~/interfaces/activity';
import { PageDeleteConfigValue } from '~/interfaces/page-delete-config';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import ShareLink from '~/server/models/share-link';
import { configManager } from '~/server/service/config-manager';
import { getTranslation } from '~/server/service/i18next';
import loggerFactory from '~/utils/logger';
import {
  prepareDeleteConfigValuesForCalc,
  validateDeleteConfigs,
} from '~/utils/page-delete-config';

import { checkSetupStrategiesHasAdmin } from './checkSetupStrategiesHasAdmin';

const logger = loggerFactory('growi:routes:apiv3:security-setting');

const express = require('express');

const router = express.Router();

const { body } = require('express-validator');

const validator = {
  generalSetting: [
    body('sessionMaxAge').optional({ checkFalsy: true }).trim().isInt(),
    body('restrictGuestMode')
      .if((value) => value != null)
      .isString()
      .isIn(['Deny', 'Readonly']),
    body('pageCompleteDeletionAuthority')
      .if((value) => value != null)
      .isString()
      .isIn(Object.values(PageDeleteConfigValue)),
    body('hideRestrictedByOwner')
      .if((value) => value != null)
      .isBoolean(),
    body('hideRestrictedByGroup')
      .if((value) => value != null)
      .isBoolean(),
    body('isUsersHomepageDeletionEnabled')
      .if((value) => value != null)
      .isBoolean(),
    body('isForceDeleteUserHomepageOnUserDeletion')
      .if((value) => value != null)
      .isBoolean(),
  ],
  shareLinkSetting: [
    body('disableLinkSharing')
      .if((value) => value != null)
      .isBoolean(),
  ],
  authenticationSetting: [
    body('isEnabled')
      .if((value) => value != null)
      .isBoolean(),
    body('authId')
      .isString()
      .isIn(['local', 'ldap', 'saml', 'oidc', 'google', 'github']),
  ],
  localSetting: [
    body('registrationMode').isString().isIn(['Open', 'Restricted', 'Closed']),
    body('registrationWhitelist')
      .if((value) => value != null)
      .isArray()
      .customSanitizer((value, { req }) => {
        return value.filter((email) => email !== '');
      }),
  ],
  ldapAuth: [
    body('serverUrl')
      .if((value) => value != null)
      .isString(),
    body('isUserBind')
      .if((value) => value != null)
      .isBoolean(),
    body('ldapBindDN')
      .if((value) => value != null)
      .isString(),
    body('ldapBindDNPassword')
      .if((value) => value != null)
      .isString(),
    body('ldapSearchFilter')
      .if((value) => value != null)
      .isString(),
    body('ldapAttrMapUsername')
      .if((value) => value != null)
      .isString(),
    body('isSameUsernameTreatedAsIdenticalUser')
      .if((value) => value != null)
      .isBoolean(),
    body('ldapAttrMapMail')
      .if((value) => value != null)
      .isString(),
    body('ldapAttrMapName')
      .if((value) => value != null)
      .isString(),
    body('ldapGroupSearchBase')
      .if((value) => value != null)
      .isString(),
    body('ldapGroupSearchFilter')
      .if((value) => value != null)
      .isString(),
    body('ldapGroupDnProperty')
      .if((value) => value != null)
      .isString(),
  ],
  samlAuth: [
    body('entryPoint')
      .if((value) => value != null)
      .isString(),
    body('issuer')
      .if((value) => value != null)
      .isString(),
    body('cert')
      .if((value) => value != null)
      .isString(),
    body('attrMapId')
      .if((value) => value != null)
      .isString(),
    body('attrMapUsername')
      .if((value) => value != null)
      .isString(),
    body('attrMapMail')
      .if((value) => value != null)
      .isString(),
    body('attrMapFirstName')
      .if((value) => value != null)
      .isString(),
    body('attrMapLastName')
      .if((value) => value != null)
      .isString(),
    body('isSameUsernameTreatedAsIdenticalUser')
      .if((value) => value != null)
      .isBoolean(),
    body('isSameEmailTreatedAsIdenticalUser')
      .if((value) => value != null)
      .isBoolean(),
    body('ABLCRule')
      .if((value) => value != null)
      .isString(),
  ],
  oidcAuth: [
    body('oidcProviderName')
      .if((value) => value != null)
      .isString(),
    body('oidcIssuerHost')
      .if((value) => value != null)
      .isString(),
    body('oidcAuthorizationEndpoint')
      .if((value) => value != null)
      .isString(),
    body('oidcTokenEndpoint')
      .if((value) => value != null)
      .isString(),
    body('oidcRevocationEndpoint')
      .if((value) => value != null)
      .isString(),
    body('oidcIntrospectionEndpoint')
      .if((value) => value != null)
      .isString(),
    body('oidcUserInfoEndpoint')
      .if((value) => value != null)
      .isString(),
    body('oidcEndSessionEndpoint')
      .if((value) => value != null)
      .isString(),
    body('oidcRegistrationEndpoint')
      .if((value) => value != null)
      .isString(),
    body('oidcJWKSUri')
      .if((value) => value != null)
      .isString(),
    body('oidcClientId')
      .if((value) => value != null)
      .isString(),
    body('oidcClientSecret')
      .if((value) => value != null)
      .isString(),
    body('oidcAttrMapId')
      .if((value) => value != null)
      .isString(),
    body('oidcAttrMapUserName')
      .if((value) => value != null)
      .isString(),
    body('oidcAttrMapEmail')
      .if((value) => value != null)
      .isString(),
    body('isSameUsernameTreatedAsIdenticalUser')
      .if((value) => value != null)
      .isBoolean(),
    body('isSameEmailTreatedAsIdenticalUser')
      .if((value) => value != null)
      .isBoolean(),
  ],
  googleOAuth: [
    body('googleClientId')
      .if((value) => value != null)
      .isString(),
    body('googleClientSecret')
      .if((value) => value != null)
      .isString(),
    body('isSameUsernameTreatedAsIdenticalUser')
      .if((value) => value != null)
      .isBoolean(),
  ],
  githubOAuth: [
    body('githubClientId')
      .if((value) => value != null)
      .isString(),
    body('githubClientSecret')
      .if((value) => value != null)
      .isString(),
    body('isSameUsernameTreatedAsIdenticalUser')
      .if((value) => value != null)
      .isBoolean(),
  ],
};

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      GeneralSetting:
 *        type: object
 *        properties:
 *          restrictGuestMode:
 *            type: string
 *            description: type of restrictGuestMode
 *          pageDeletionAuthority:
 *            type: string
 *            description: type of pageDeletionAuthority
 *          pageRecursiveDeletionAuthority:
 *            type: string
 *            description: type of pageRecursiveDeletionAuthority
 *          pageRecursiveCompleteDeletionAuthority:
 *            type: string
 *            description: type of pageRecursiveCompleteDeletionAuthority
 *          isAllGroupMembershipRequiredForPageCompleteDeletion:
 *            type: boolean
 *            description: enable all group membership required for page complete deletion
 *          pageCompleteDeletionAuthority:
 *            type: string
 *            description: type of pageDeletionAuthority
 *          hideRestrictedByOwner:
 *            type: boolean
 *            description: enable hide by owner
 *          hideRestrictedByGroup:
 *            type: boolean
 *            description: enable hide by group
 *          isUsersHomepageDeletionEnabled:
 *            type: boolean
 *            description: enable user homepage deletion
 *          isForceDeleteUserHomepageOnUserDeletion:
 *            type: boolean
 *            description: enable force delete user homepage on user deletion
 *          isRomUserAllowedToComment:
 *            type: boolean
 *            description: enable rom user allowed to comment
 *          wikiMode:
 *            type: string
 *            description: type of wikiMode
 *          sessionMaxAge:
 *            type: integer
 *            description: max age of session
 *      ShareLinkSetting:
 *        type: object
 *        properties:
 *          disableLinkSharing:
 *            type: boolean
 *            description: disable link sharing
 *      LocalSetting:
 *        type: object
 *        properties:
 *          useOnlyEnvVarsForSomeOptions:
 *            type: boolean
 *            description: use only env vars for some options
 *          isPasswordResetEnabled:
 *            type: boolean
 *            description: enable password reset
 *          isEmailAuthenticationEnabled:
 *            type: boolean
 *            description: enable email authentication
 *          isLocalEnabled:
 *            type: boolean
 *            description: local setting mode
 *          registrationMode:
 *            type: string
 *            description: type of registrationMode
 *          registrationWhitelist:
 *            type: array
 *            description: array of regsitrationList
 *            items:
 *              type: string
 *              description: registration whitelist
 *      GeneralAuthSetting:
 *        type: object
 *        properties:
 *          isLocalEnabled:
 *            type: boolean
 *            description: local setting mode
 *          isLdapEnabled:
 *            type: boolean
 *            description: ldap setting mode
 *          isSamlEnabled:
 *            type: boolean
 *            description: saml setting mode
 *          isOidcEnabled:
 *            type: boolean
 *            description: oidc setting mode
 *          isGoogleEnabled:
 *            type: boolean
 *            description: google setting mode
 *          isGitHubEnabled:
 *            type: boolean
 *            description: github setting mode
 *      LdapAuthSetting:
 *        type: object
 *        properties:
 *          serverUrl:
 *            type: string
 *            description: server url for ldap
 *          isUserBind:
 *            type: boolean
 *            description: enable user bind
 *          ldapBindDN:
 *            type: string
 *            description: the query used to bind with the directory service
 *          ldapBindDNPassword:
 *            type: string
 *            description: the password that is entered in the login page will be used to bind
 *          ldapSearchFilter:
 *            type: string
 *            description: the query used to locate the authenticated user
 *          ldapAttrMapUsername:
 *            type: string
 *            description: specification of mappings for username when creating new users
 *          isSameUsernameTreatedAsIdenticalUser:
 *            type: boolean
 *            description: local account automatically linked the user name matched
 *          ldapAttrMapMail:
 *            type: string
 *            description: specification of mappings for mail address when creating new users
 *          ldapAttrMapName:
 *            type: string
 *            description: Specification of mappings for full name address when creating new users
 *          ldapGroupSearchBase:
 *            type: string
 *            description: the base DN from which to search for groups.
 *          ldapGroupSearchFilter:
 *            type: string
 *            description: the query used to filter for groups
 *          ldapGroupDnProperty:
 *            type: string
 *            description: The property of user object to use in dn interpolation of Group Search Filter
 *      SamlAuthSetting:
 *        type: object
 *        properties:
 *          missingMandatoryConfigKeys:
 *            type: array
 *            description: array of missing mandatory config keys
 *            items:
 *              type: string
 *              description: missing mandatory config key
 *          useOnlyEnvVarsForSomeOptions:
 *            type: boolean
 *            description: use only env vars for some options
 *          samlEntryPoint:
 *            type: string
 *            description: entry point for saml
 *          samlIssuer:
 *            type: string
 *            description: issuer for saml
 *          samlEnvVarIssuer:
 *            type: string
 *            description: issuer for saml
 *          samlCert:
 *            type: string
 *            description: certificate for saml
 *          samlEnvVarCert:
 *            type: string
 *            description: certificate for saml
 *          samlAttrMapId:
 *            type: string
 *            description: attribute mapping id for saml
 *          samlAttrMapUserName:
 *            type: string
 *            description: attribute mapping user name for saml
 *          samlAttrMapMail:
 *            type: string
 *            description: attribute mapping mail for saml
 *          samlEnvVarAttrMapId:
 *            type: string
 *            description: attribute mapping id for saml
 *          samlEnvVarAttrMapUserName:
 *            type: string
 *            description: attribute mapping user name for saml
 *          samlEnvVarAttrMapMail:
 *            type: string
 *            description: attribute mapping mail for saml
 *          samlAttrMapFirstName:
 *            type: string
 *            description: attribute mapping first name for saml
 *          samlAttrMapLastName:
 *            type: string
 *            description: attribute mapping last name for saml
 *          samlEnvVarAttrMapFirstName:
 *            type: string
 *            description: attribute mapping first name for saml
 *          samlEnvVarAttrMapLastName:
 *            type: string
 *            description: attribute mapping last name for saml
 *          isSameUsernameTreatedAsIdenticalUser:
 *            type: boolean
 *            description: local account automatically linked the user name matched
 *          isSameEmailTreatedAsIdenticalUser:
 *            type: boolean
 *            description: local account automatically linked the email matched
 *          samlABLCRule:
 *            type: string
 *            description: ABLCRule for saml
 *          samlEnvVarABLCRule:
 *            type: string
 *            description: ABLCRule for saml
 *      OidcAuthSetting:
 *        type: object
 *        properties:
 *          oidcProviderName:
 *            type: string
 *            description: provider name for oidc
 *          oidcIssuerHost:
 *            type: string
 *            description: issuer host for oidc
 *          oidcAuthorizationEndpoint:
 *            type: string
 *            description: authorization endpoint for oidc
 *          oidcTokenEndpoint:
 *            type: string
 *            description: token endpoint for oidc
 *          oidcRevocationEndpoint:
 *            type: string
 *            description: revocation endpoint for oidc
 *          oidcIntrospectionEndpoint:
 *            type: string
 *            description: introspection endpoint for oidc
 *          oidcUserInfoEndpoint:
 *            type: string
 *            description: userinfo endpoint for oidc
 *          oidcEndSessionEndpoint:
 *            type: string
 *            description: end session endpoint for oidc
 *          oidcRegistrationEndpoint:
 *            type: string
 *            description: registration endpoint for oidc
 *          oidcJWKSUri:
 *            type: string
 *            description: JSON Web Key Set URI for oidc
 *          oidcClientId:
 *            type: string
 *            description: client id for oidc
 *          oidcClientSecret:
 *            type: string
 *            description: client secret for oidc
 *          oidcAttrMapId:
 *            type: string
 *            description: attr map id for oidc
 *          oidcAttrMapUserName:
 *            type: string
 *            description: attr map username for oidc
 *          oidcAttrMapName:
 *            type: string
 *            description: attr map name for oidc
 *          oidcAttrMapMail:
 *            type: string
 *            description: attr map mail for oidc
 *          isSameUsernameTreatedAsIdenticalUser:
 *            type: boolean
 *            description: local account automatically linked the user name matched
 *          isSameEmailTreatedAsIdenticalUser:
 *            type: boolean
 *            description: local account automatically linked the email matched
 *      GitHubOAuthSetting:
 *        type: object
 *        properties:
 *          githubClientId:
 *            type: string
 *            description: key of comsumer
 *          githubClientSecret:
 *            type: string
 *            description: password of comsumer
 *          isSameUsernameTreatedAsIdenticalUser:
 *            type: boolean
 *            description: local account automatically linked the email matched
 *      GoogleOAuthSetting:
 *        type: object
 *        properties:
 *          googleClientId:
 *            type: string
 *            description: key of comsumer
 *          googleClientSecret:
 *            type: string
 *            description: password of comsumer
 *          isSameUsernameTreatedAsIdenticalUser:
 *            type: boolean
 *            description: local account automatically linked the email matched
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );
  const adminRequired = require('~/server/middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  async function updateAndReloadStrategySettings(
    authId,
    params,
    opts = { removeIfUndefined: false },
  ) {
    const { passportService } = crowi;

    // update config without publishing S2sMessage
    await configManager.updateConfigs(params, {
      skipPubsub: true,
      removeIfUndefined: opts.removeIfUndefined,
    });

    await passportService.setupStrategyById(authId);
    passportService.publishUpdatedMessage(authId);
  }

  /**
   * @swagger
   *
   *    /security-setting/:
   *      get:
   *        tags: [SecuritySetting]
   *        description: Get security paramators
   *        responses:
   *          200:
   *            description: params of security
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securityParams:
   *                      type: object
   *                      description: security params
   *                      properties:
   *                        generalSetting:
   *                          $ref: '#/components/schemas/GeneralSetting'
   *                        shareLinkSetting:
   *                          $ref: '#/components/schemas/ShareLinkSetting'
   *                        localSetting:
   *                          $ref: '#/components/schemas/LocalSetting'
   *                        generalAuth:
   *                          $ref: '#/components/schemas/GeneralAuthSetting'
   *                        ldapAuth:
   *                          $ref: '#/components/schemas/LdapAuthSetting'
   *                        samlAuth:
   *                          $ref: '#/components/schemas/SamlAuthSetting'
   *                        oidcAuth:
   *                          $ref: '#/components/schemas/OidcAuthSetting'
   *                        googleOAuth:
   *                          $ref: '#/components/schemas/GoogleOAuthSetting'
   *                        githubOAuth:
   *                          $ref: '#/components/schemas/GitHubOAuthSetting'
   */
  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      const securityParams = {
        generalSetting: {
          restrictGuestMode: crowi.aclService.getGuestModeValue(),
          pageDeletionAuthority: await configManager.getConfig(
            'security:pageDeletionAuthority',
          ),
          pageCompleteDeletionAuthority: await configManager.getConfig(
            'security:pageCompleteDeletionAuthority',
          ),
          pageRecursiveDeletionAuthority: await configManager.getConfig(
            'security:pageRecursiveDeletionAuthority',
          ),
          pageRecursiveCompleteDeletionAuthority: await configManager.getConfig(
            'security:pageRecursiveCompleteDeletionAuthority',
          ),
          isAllGroupMembershipRequiredForPageCompleteDeletion:
            await configManager.getConfig(
              'security:isAllGroupMembershipRequiredForPageCompleteDeletion',
            ),
          hideRestrictedByOwner: await configManager.getConfig(
            'security:list-policy:hideRestrictedByOwner',
          ),
          hideRestrictedByGroup: await configManager.getConfig(
            'security:list-policy:hideRestrictedByGroup',
          ),
          isUsersHomepageDeletionEnabled: await configManager.getConfig(
            'security:user-homepage-deletion:isEnabled',
          ),
          isForceDeleteUserHomepageOnUserDeletion:
            await configManager.getConfig(
              'security:user-homepage-deletion:isForceDeleteUserHomepageOnUserDeletion',
            ),
          isRomUserAllowedToComment: await configManager.getConfig(
            'security:isRomUserAllowedToComment',
          ),
          wikiMode: await configManager.getConfig('security:wikiMode'),
          sessionMaxAge: await configManager.getConfig(
            'security:sessionMaxAge',
          ),
        },
        shareLinkSetting: {
          disableLinkSharing: await configManager.getConfig(
            'security:disableLinkSharing',
          ),
        },
        localSetting: {
          useOnlyEnvVarsForSomeOptions: await configManager.getConfig(
            'env:useOnlyEnvVars:security:passport-local',
          ),
          registrationMode: await configManager.getConfig(
            'security:registrationMode',
          ),
          registrationWhitelist: await configManager.getConfig(
            'security:registrationWhitelist',
          ),
          isPasswordResetEnabled: await configManager.getConfig(
            'security:passport-local:isPasswordResetEnabled',
          ),
          isEmailAuthenticationEnabled: await configManager.getConfig(
            'security:passport-local:isEmailAuthenticationEnabled',
          ),
        },
        generalAuth: {
          isLocalEnabled: await configManager.getConfig(
            'security:passport-local:isEnabled',
          ),
          isLdapEnabled: await configManager.getConfig(
            'security:passport-ldap:isEnabled',
          ),
          isSamlEnabled: await configManager.getConfig(
            'security:passport-saml:isEnabled',
          ),
          isOidcEnabled: await configManager.getConfig(
            'security:passport-oidc:isEnabled',
          ),
          isGoogleEnabled: await configManager.getConfig(
            'security:passport-google:isEnabled',
          ),
          isGitHubEnabled: await configManager.getConfig(
            'security:passport-github:isEnabled',
          ),
        },
        ldapAuth: {
          serverUrl: await configManager.getConfig(
            'security:passport-ldap:serverUrl',
          ),
          isUserBind: await configManager.getConfig(
            'security:passport-ldap:isUserBind',
          ),
          ldapBindDN: await configManager.getConfig(
            'security:passport-ldap:bindDN',
          ),
          ldapBindDNPassword: await configManager.getConfig(
            'security:passport-ldap:bindDNPassword',
          ),
          ldapSearchFilter: await configManager.getConfig(
            'security:passport-ldap:searchFilter',
          ),
          ldapAttrMapUsername: await configManager.getConfig(
            'security:passport-ldap:attrMapUsername',
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-ldap:isSameUsernameTreatedAsIdenticalUser',
          ),
          ldapAttrMapMail: await configManager.getConfig(
            'security:passport-ldap:attrMapMail',
          ),
          ldapAttrMapName: await configManager.getConfig(
            'security:passport-ldap:attrMapName',
          ),
          ldapGroupSearchBase: await configManager.getConfig(
            'security:passport-ldap:groupSearchBase',
          ),
          ldapGroupSearchFilter: await configManager.getConfig(
            'security:passport-ldap:groupSearchFilter',
          ),
          ldapGroupDnProperty: await configManager.getConfig(
            'security:passport-ldap:groupDnProperty',
          ),
        },
        samlAuth: {
          missingMandatoryConfigKeys:
            await crowi.passportService.getSamlMissingMandatoryConfigKeys(),
          useOnlyEnvVarsForSomeOptions: await configManager.getConfig(
            'env:useOnlyEnvVars:security:passport-saml',
            ConfigSource.env,
          ),
          samlEntryPoint: await configManager.getConfig(
            'security:passport-saml:entryPoint',
            ConfigSource.db,
          ),
          samlEnvVarEntryPoint: await configManager.getConfig(
            'security:passport-saml:entryPoint',
            ConfigSource.env,
          ),
          samlIssuer: await configManager.getConfig(
            'security:passport-saml:issuer',
            ConfigSource.db,
          ),
          samlEnvVarIssuer: await configManager.getConfig(
            'security:passport-saml:issuer',
            ConfigSource.env,
          ),
          samlCert: await configManager.getConfig(
            'security:passport-saml:cert',
            ConfigSource.db,
          ),
          samlEnvVarCert: await configManager.getConfig(
            'security:passport-saml:cert',
            ConfigSource.env,
          ),
          samlAttrMapId: await configManager.getConfig(
            'security:passport-saml:attrMapId',
            ConfigSource.db,
          ),
          samlEnvVarAttrMapId: await configManager.getConfig(
            'security:passport-saml:attrMapId',
            ConfigSource.env,
          ),
          samlAttrMapUsername: await configManager.getConfig(
            'security:passport-saml:attrMapUsername',
            ConfigSource.db,
          ),
          samlEnvVarAttrMapUsername: await configManager.getConfig(
            'security:passport-saml:attrMapUsername',
            ConfigSource.env,
          ),
          samlAttrMapMail: await configManager.getConfig(
            'security:passport-saml:attrMapMail',
            ConfigSource.db,
          ),
          samlEnvVarAttrMapMail: await configManager.getConfig(
            'security:passport-saml:attrMapMail',
            ConfigSource.env,
          ),
          samlAttrMapFirstName: await configManager.getConfig(
            'security:passport-saml:attrMapFirstName',
            ConfigSource.db,
          ),
          samlEnvVarAttrMapFirstName: await configManager.getConfig(
            'security:passport-saml:attrMapFirstName',
            ConfigSource.env,
          ),
          samlAttrMapLastName: await configManager.getConfig(
            'security:passport-saml:attrMapLastName',
            ConfigSource.db,
          ),
          samlEnvVarAttrMapLastName: await configManager.getConfig(
            'security:passport-saml:attrMapLastName',
            ConfigSource.env,
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-saml:isSameUsernameTreatedAsIdenticalUser',
          ),
          isSameEmailTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-saml:isSameEmailTreatedAsIdenticalUser',
          ),
          samlABLCRule: await configManager.getConfig(
            'security:passport-saml:ABLCRule',
            ConfigSource.db,
          ),
          samlEnvVarABLCRule: await configManager.getConfig(
            'security:passport-saml:ABLCRule',
            ConfigSource.env,
          ),
        },
        oidcAuth: {
          oidcProviderName: await configManager.getConfig(
            'security:passport-oidc:providerName',
          ),
          oidcIssuerHost: await configManager.getConfig(
            'security:passport-oidc:issuerHost',
          ),
          oidcAuthorizationEndpoint: await configManager.getConfig(
            'security:passport-oidc:authorizationEndpoint',
          ),
          oidcTokenEndpoint: await configManager.getConfig(
            'security:passport-oidc:tokenEndpoint',
          ),
          oidcRevocationEndpoint: await configManager.getConfig(
            'security:passport-oidc:revocationEndpoint',
          ),
          oidcIntrospectionEndpoint: await configManager.getConfig(
            'security:passport-oidc:introspectionEndpoint',
          ),
          oidcUserInfoEndpoint: await configManager.getConfig(
            'security:passport-oidc:userInfoEndpoint',
          ),
          oidcEndSessionEndpoint: await configManager.getConfig(
            'security:passport-oidc:endSessionEndpoint',
          ),
          oidcRegistrationEndpoint: await configManager.getConfig(
            'security:passport-oidc:registrationEndpoint',
          ),
          oidcJWKSUri: await configManager.getConfig(
            'security:passport-oidc:jwksUri',
          ),
          oidcClientId: await configManager.getConfig(
            'security:passport-oidc:clientId',
          ),
          oidcClientSecret: await configManager.getConfig(
            'security:passport-oidc:clientSecret',
          ),
          oidcAttrMapId: await configManager.getConfig(
            'security:passport-oidc:attrMapId',
          ),
          oidcAttrMapUserName: await configManager.getConfig(
            'security:passport-oidc:attrMapUserName',
          ),
          oidcAttrMapName: await configManager.getConfig(
            'security:passport-oidc:attrMapName',
          ),
          oidcAttrMapEmail: await configManager.getConfig(
            'security:passport-oidc:attrMapMail',
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-oidc:isSameUsernameTreatedAsIdenticalUser',
          ),
          isSameEmailTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-oidc:isSameEmailTreatedAsIdenticalUser',
          ),
        },
        googleOAuth: {
          googleClientId: await configManager.getConfig(
            'security:passport-google:clientId',
          ),
          googleClientSecret: await configManager.getConfig(
            'security:passport-google:clientSecret',
          ),
          isSameEmailTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-google:isSameEmailTreatedAsIdenticalUser',
          ),
        },
        githubOAuth: {
          githubClientId: await configManager.getConfig(
            'security:passport-github:clientId',
          ),
          githubClientSecret: await configManager.getConfig(
            'security:passport-github:clientSecret',
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-github:isSameUsernameTreatedAsIdenticalUser',
          ),
        },
      };
      return res.apiv3({ securityParams });
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/authentication/enabled:
   *      put:
   *        tags: [SecuritySetting]
   *        description: Update authentication isEnabled
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  isEnabled:
   *                    type: boolean
   *                  authId:
   *                    type: string
   *        responses:
   *          200:
   *            description: Succeeded to enable authentication
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  description: updated param
   */
  // eslint-disable-next-line max-len
  router.put(
    '/authentication/enabled',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.authenticationSetting,
    apiV3FormValidator,
    async (req, res) => {
      const { isEnabled, authId } = req.body;

      let setupStrategies = await crowi.passportService.getSetupStrategies();

      const parameters = {};

      // Reflect request param
      setupStrategies = setupStrategies.filter(
        (strategy) => strategy !== authId,
      );

      if (setupStrategies.length === 0) {
        return res.apiv3Err(new ErrorV3('Can not turn everything off'), 405);
      }

      if (!isEnabled) {
        const isSetupStrategiesHasAdmin =
          await checkSetupStrategiesHasAdmin(setupStrategies);

        // Return an error when disabling an strategy when there are no setup strategies with admin-enabled login
        if (!isSetupStrategiesHasAdmin) {
          return res.apiv3Err(
            new ErrorV3('Must have admin enabled authentication method'),
            405,
          );
        }
      }

      const enableParams = {
        [`security:passport-${authId}:isEnabled`]: isEnabled,
      };

      try {
        await updateAndReloadStrategySettings(authId, enableParams);

        const responseParams = {
          [`security:passport-${authId}:isEnabled`]:
            await configManager.getConfig(
              `security:passport-${authId}:isEnabled`,
            ),
        };
        switch (authId) {
          case 'local':
            if (isEnabled) {
              parameters.action =
                SupportedAction.ACTION_ADMIN_AUTH_ID_PASS_ENABLED;
              break;
            }
            parameters.action =
              SupportedAction.ACTION_ADMIN_AUTH_ID_PASS_DISABLED;
            break;
          case 'ldap':
            if (isEnabled) {
              parameters.action =
                SupportedAction.ACTION_ADMIN_AUTH_LDAP_ENABLED;
              break;
            }
            parameters.action = SupportedAction.ACTION_ADMIN_AUTH_LDAP_DISABLED;
            break;
          case 'saml':
            if (isEnabled) {
              parameters.action =
                SupportedAction.ACTION_ADMIN_AUTH_SAML_ENABLED;
              break;
            }
            parameters.action = SupportedAction.ACTION_ADMIN_AUTH_SAML_DISABLED;
            break;
          case 'oidc':
            if (isEnabled) {
              parameters.action =
                SupportedAction.ACTION_ADMIN_AUTH_OIDC_ENABLED;
              break;
            }
            parameters.action = SupportedAction.ACTION_ADMIN_AUTH_OIDC_DISABLED;
            break;
          case 'google':
            if (isEnabled) {
              parameters.action =
                SupportedAction.ACTION_ADMIN_AUTH_GOOGLE_ENABLED;
              break;
            }
            parameters.action =
              SupportedAction.ACTION_ADMIN_AUTH_GOOGLE_DISABLED;
            break;
          case 'github':
            if (isEnabled) {
              parameters.action =
                SupportedAction.ACTION_ADMIN_AUTH_GITHUB_ENABLED;
              break;
            }
            parameters.action =
              SupportedAction.ACTION_ADMIN_AUTH_GITHUB_DISABLED;
            break;
        }
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ responseParams });
      } catch (err) {
        const msg = 'Error occurred in updating enable setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-enable-setting failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/authentication:
   *      get:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/authentication
   *        description: Get setup strategies for passport
   *        responses:
   *          200:
   *            description: params of setup strategies
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    setupStrategies:
   *                      type: array
   *                      description: setup strategies list
   *                      items:
   *                        type: string
   *                        description: setup strategie
   *                      example: ["local"]
   */
  router.get(
    '/authentication/',
    accessTokenParser([SCOPE.READ.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      const setupStrategies = await crowi.passportService.getSetupStrategies();

      return res.apiv3({ setupStrategies });
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/general-setting:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/general-setting
   *        description: Update GeneralSetting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/GeneralSetting'
   *        responses:
   *          200:
   *            description: Succeeded to update general Setting
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/GeneralSetting'
   */
  router.put(
    '/general-setting',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.generalSetting,
    apiV3FormValidator,
    async (req, res) => {
      const updateData = {
        'security:sessionMaxAge': parseInt(req.body.sessionMaxAge),
        'security:restrictGuestMode': req.body.restrictGuestMode,
        'security:pageDeletionAuthority': req.body.pageDeletionAuthority,
        'security:pageRecursiveDeletionAuthority':
          req.body.pageRecursiveDeletionAuthority,
        'security:pageCompleteDeletionAuthority':
          req.body.pageCompleteDeletionAuthority,
        'security:pageRecursiveCompleteDeletionAuthority':
          req.body.pageRecursiveCompleteDeletionAuthority,
        'security:isAllGroupMembershipRequiredForPageCompleteDeletion':
          req.body.isAllGroupMembershipRequiredForPageCompleteDeletion,
        'security:list-policy:hideRestrictedByOwner':
          req.body.hideRestrictedByOwner,
        'security:list-policy:hideRestrictedByGroup':
          req.body.hideRestrictedByGroup,
        'security:user-homepage-deletion:isEnabled':
          req.body.isUsersHomepageDeletionEnabled,
        // Validate user-homepage-deletion config
        'security:user-homepage-deletion:isForceDeleteUserHomepageOnUserDeletion':
          req.body.isUsersHomepageDeletionEnabled
            ? req.body.isForceDeleteUserHomepageOnUserDeletion
            : false,
        'security:isRomUserAllowedToComment':
          req.body.isRomUserAllowedToComment,
      };

      // Validate delete config
      const [singleAuthority1, recursiveAuthority1] =
        prepareDeleteConfigValuesForCalc(
          req.body.pageDeletionAuthority,
          req.body.pageRecursiveDeletionAuthority,
        );
      // eslint-disable-next-line max-len
      const [singleAuthority2, recursiveAuthority2] =
        prepareDeleteConfigValuesForCalc(
          req.body.pageCompleteDeletionAuthority,
          req.body.pageRecursiveCompleteDeletionAuthority,
        );
      const isDeleteConfigNormalized =
        validateDeleteConfigs(singleAuthority1, recursiveAuthority1) &&
        validateDeleteConfigs(singleAuthority2, recursiveAuthority2);
      if (!isDeleteConfigNormalized) {
        return res.apiv3Err(
          new ErrorV3(
            'Delete config values are not correct.',
            'delete_config_not_normalized',
          ),
        );
      }

      const wikiMode = await configManager.getConfig('security:wikiMode');
      if (wikiMode === 'private' || wikiMode === 'public') {
        logger.debug(
          'security:restrictGuestMode will not be changed because wiki mode is forced to set',
        );
        delete updateData['security:restrictGuestMode'];
      }
      try {
        await configManager.updateConfigs(updateData);
        const securitySettingParams = {
          sessionMaxAge: await configManager.getConfig(
            'security:sessionMaxAge',
          ),
          restrictGuestMode: await configManager.getConfig(
            'security:restrictGuestMode',
          ),
          pageDeletionAuthority: await configManager.getConfig(
            'security:pageDeletionAuthority',
          ),
          pageCompleteDeletionAuthority: await configManager.getConfig(
            'security:pageCompleteDeletionAuthority',
          ),
          pageRecursiveDeletionAuthority: await configManager.getConfig(
            'security:pageRecursiveDeletionAuthority',
          ),
          pageRecursiveCompleteDeletionAuthority: await configManager.getConfig(
            'security:pageRecursiveCompleteDeletionAuthority',
          ),
          isAllGroupMembershipRequiredForPageCompleteDeletion:
            await configManager.getConfig(
              'security:isAllGroupMembershipRequiredForPageCompleteDeletion',
            ),
          hideRestrictedByOwner: await configManager.getConfig(
            'security:list-policy:hideRestrictedByOwner',
          ),
          hideRestrictedByGroup: await configManager.getConfig(
            'security:list-policy:hideRestrictedByGroup',
          ),
          isUsersHomepageDeletionEnabled: await configManager.getConfig(
            'security:user-homepage-deletion:isEnabled',
          ),
          isForceDeleteUserHomepageOnUserDeletion:
            await configManager.getConfig(
              'security:user-homepage-deletion:isForceDeleteUserHomepageOnUserDeletion',
            ),
          isRomUserAllowedToComment: await configManager.getConfig(
            'security:isRomUserAllowedToComment',
          ),
        };

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_SECURITY_SETTINGS_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ securitySettingParams });
      } catch (err) {
        const msg = 'Error occurred in updating security setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-secuirty-setting failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/share-link-setting:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/share-link-setting
   *        description: Update ShareLink Setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/ShareLinkSetting'
   *        responses:
   *          200:
   *            description: Succeeded to update ShareLink Setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securitySettingParams:
   *                      $ref: '#/components/schemas/ShareLinkSetting'
   */
  router.put(
    '/share-link-setting',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.generalSetting,
    apiV3FormValidator,
    async (req, res) => {
      const updateData = {
        'security:disableLinkSharing': req.body.disableLinkSharing,
      };
      try {
        await configManager.updateConfigs(updateData);
        const securitySettingParams = {
          disableLinkSharing: configManager.getConfig(
            'security:disableLinkSharing',
          ),
        };
        // eslint-disable-next-line max-len
        const parameters = {
          action: updateData['security:disableLinkSharing']
            ? SupportedAction.ACTION_ADMIN_REJECT_SHARE_LINK
            : SupportedAction.ACTION_ADMIN_PERMIT_SHARE_LINK,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ securitySettingParams });
      } catch (err) {
        const msg = 'Error occurred in updating security setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-secuirty-setting failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/all-share-links:
   *      get:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/all-share-links
   *        description: Get All ShareLinks at Share Link Setting
   *        responses:
   *          200:
   *            description: all share links
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securityParams:
   *                      type: object
   *                      description: suceed to get all share links
   */
  router.get(
    '/all-share-links/',
    accessTokenParser([SCOPE.READ.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const linkQuery = {};
      try {
        const paginateResult = await ShareLink.paginate(linkQuery, {
          page,
          limit,
          populate: {
            path: 'relatedPage',
            select: 'path',
          },
        });
        return res.apiv3({ paginateResult });
      } catch (err) {
        const msg = 'Error occured in get share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'get-all-share-links-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/all-share-links:
   *      delete:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/all-share-links
   *        description: Delete All ShareLinks at Share Link Setting
   *        responses:
   *          200:
   *            description: succeed to delete all share links
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    removeTotal:
   *                      type: number
   *                      description: total number of removed share links
   */
  router.delete(
    '/all-share-links/',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      try {
        const removedAct = await ShareLink.remove({});
        const removeTotal = await removedAct.n;
        return res.apiv3({ removeTotal });
      } catch (err) {
        const msg = 'Error occured in delete all share links';
        logger.error('Error', err);
        return res.apiv3Err(
          new ErrorV3(msg, 'failed-to-delete-all-share-links'),
        );
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/local-setting:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/local-setting
   *        description: Update LocalSetting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/LocalSetting'
   *        responses:
   *          200:
   *            description: Succeeded to update local Setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    localSettingParams:
   *                      $ref: '#/components/schemas/LocalSetting'
   */
  router.put(
    '/local-setting',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.localSetting,
    apiV3FormValidator,
    async (req, res) => {
      try {
        const sanitizedRegistrationWhitelist =
          req.body.registrationWhitelist.map((line) =>
            xss(line, { stripIgnoreTag: true }),
          );

        const requestParams = {
          'security:registrationMode': req.body.registrationMode,
          'security:registrationWhitelist': sanitizedRegistrationWhitelist,
          'security:passport-local:isPasswordResetEnabled':
            req.body.isPasswordResetEnabled,
          'security:passport-local:isEmailAuthenticationEnabled':
            req.body.isEmailAuthenticationEnabled,
        };

        await updateAndReloadStrategySettings('local', requestParams);

        const localSettingParams = {
          registrationMode: await configManager.getConfig(
            'security:registrationMode',
          ),
          registrationWhitelist: await configManager.getConfig(
            'security:registrationWhitelist',
          ),
          isPasswordResetEnabled: await configManager.getConfig(
            'security:passport-local:isPasswordResetEnabled',
          ),
          isEmailAuthenticationEnabled: await configManager.getConfig(
            'security:passport-local:isEmailAuthenticationEnabled',
          ),
        };
        const parameters = {
          action: SupportedAction.ACTION_ADMIN_AUTH_ID_PASS_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ localSettingParams });
      } catch (err) {
        const msg = 'Error occurred in updating local setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-local-setting failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/ldap:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/ldap
   *        description: Update LDAP setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/LdapAuthSetting'
   *        responses:
   *          200:
   *            description: Succeeded to update LDAP setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securitySettingParams:
   *                      $ref: '#/components/schemas/LdapAuthSetting'
   */
  router.put(
    '/ldap',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.ldapAuth,
    apiV3FormValidator,
    async (req, res) => {
      const requestParams = {
        'security:passport-ldap:serverUrl': req.body.serverUrl,
        'security:passport-ldap:isUserBind': req.body.isUserBind,
        'security:passport-ldap:bindDN': req.body.ldapBindDN,
        'security:passport-ldap:bindDNPassword': req.body.ldapBindDNPassword,
        'security:passport-ldap:searchFilter': req.body.ldapSearchFilter,
        'security:passport-ldap:attrMapUsername': req.body.ldapAttrMapUsername,
        'security:passport-ldap:isSameUsernameTreatedAsIdenticalUser':
          req.body.isSameUsernameTreatedAsIdenticalUser,
        'security:passport-ldap:attrMapMail': req.body.ldapAttrMapMail,
        'security:passport-ldap:attrMapName': req.body.ldapAttrMapName,
        'security:passport-ldap:groupSearchBase': req.body.ldapGroupSearchBase,
        'security:passport-ldap:groupSearchFilter':
          req.body.ldapGroupSearchFilter,
        'security:passport-ldap:groupDnProperty': req.body.ldapGroupDnProperty,
      };

      try {
        await updateAndReloadStrategySettings('ldap', requestParams);

        const securitySettingParams = {
          serverUrl: await configManager.getConfig(
            'security:passport-ldap:serverUrl',
          ),
          isUserBind: await configManager.getConfig(
            'security:passport-ldap:isUserBind',
          ),
          ldapBindDN: await configManager.getConfig(
            'security:passport-ldap:bindDN',
          ),
          ldapBindDNPassword: await configManager.getConfig(
            'security:passport-ldap:bindDNPassword',
          ),
          ldapSearchFilter: await configManager.getConfig(
            'security:passport-ldap:searchFilter',
          ),
          ldapAttrMapUsername: await configManager.getConfig(
            'security:passport-ldap:attrMapUsername',
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-ldap:isSameUsernameTreatedAsIdenticalUser',
          ),
          ldapAttrMapMail: await configManager.getConfig(
            'security:passport-ldap:attrMapMail',
          ),
          ldapAttrMapName: await configManager.getConfig(
            'security:passport-ldap:attrMapName',
          ),
          ldapGroupSearchBase: await configManager.getConfig(
            'security:passport-ldap:groupSearchBase',
          ),
          ldapGroupSearchFilter: await configManager.getConfig(
            'security:passport-ldap:groupSearchFilter',
          ),
          ldapGroupDnProperty: await configManager.getConfig(
            'security:passport-ldap:groupDnProperty',
          ),
        };
        const parameters = {
          action: SupportedAction.ACTION_ADMIN_AUTH_LDAP_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ securitySettingParams });
      } catch (err) {
        const msg = 'Error occurred in updating SAML setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-SAML-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/saml:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/saml
   *        description: Update SAML setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/SamlAuthSetting'
   *        responses:
   *          200:
   *            description: Succeeded to update SAML setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securitySettingParams:
   *                      $ref: '#/components/schemas/SamlAuthSetting'
   */
  router.put(
    '/saml',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.samlAuth,
    apiV3FormValidator,
    async (req, res) => {
      const { t } = await getTranslation({
        lang: req.user.lang,
        ns: ['translation', 'admin'],
      });

      //  For the value of each mandatory items,
      //  check whether it from the environment variables is empty and form value to update it is empty
      //  validate the syntax of a attribute - based login control rule
      const invalidValues = [];
      for (const configKey of crowi.passportService
        .mandatoryConfigKeysForSaml) {
        const key = configKey.replace('security:passport-saml:', '');
        const formValue = req.body[key];
        if (
          configManager.getConfig(configKey, ConfigSource.env) == null &&
          formValue == null
        ) {
          const formItemName = t(`security_settings.form_item_name.${key}`);
          invalidValues.push(
            t('input_validation.message.required', { param: formItemName }),
          );
        }
      }
      if (invalidValues.length !== 0) {
        return res.apiv3Err(
          t('input_validation.message.error_message'),
          400,
          invalidValues,
        );
      }

      const rule = req.body.ABLCRule;
      // Empty string disables attribute-based login control.
      // So, when rule is empty string, validation is passed.
      if (rule != null) {
        try {
          crowi.passportService.parseABLCRule(rule);
        } catch (err) {
          return res.apiv3Err(
            t('input_validation.message.invalid_syntax', {
              syntax: t('security_settings.form_item_name.ABLCRule'),
            }),
            400,
          );
        }
      }

      const requestParams = {
        'security:passport-saml:entryPoint': req.body.entryPoint,
        'security:passport-saml:issuer': req.body.issuer,
        'security:passport-saml:cert': req.body.cert,
        'security:passport-saml:attrMapId': req.body.attrMapId,
        'security:passport-saml:attrMapUsername': req.body.attrMapUsername,
        'security:passport-saml:attrMapMail': req.body.attrMapMail,
        'security:passport-saml:attrMapFirstName': req.body.attrMapFirstName,
        'security:passport-saml:attrMapLastName': req.body.attrMapLastName,
        'security:passport-saml:isSameUsernameTreatedAsIdenticalUser':
          req.body.isSameUsernameTreatedAsIdenticalUser,
        'security:passport-saml:isSameEmailTreatedAsIdenticalUser':
          req.body.isSameEmailTreatedAsIdenticalUser,
        'security:passport-saml:ABLCRule': req.body.ABLCRule,
      };

      try {
        await updateAndReloadStrategySettings('saml', requestParams);

        const securitySettingParams = {
          missingMandatoryConfigKeys:
            await crowi.passportService.getSamlMissingMandatoryConfigKeys(),
          samlEntryPoint: await configManager.getConfig(
            'security:passport-saml:entryPoint',
            ConfigSource.db,
          ),
          samlIssuer: await configManager.getConfig(
            'security:passport-saml:issuer',
            ConfigSource.db,
          ),
          samlCert: await configManager.getConfig(
            'security:passport-saml:cert',
            ConfigSource.db,
          ),
          samlAttrMapId: await configManager.getConfig(
            'security:passport-saml:attrMapId',
            ConfigSource.db,
          ),
          samlAttrMapUsername: await configManager.getConfig(
            'security:passport-saml:attrMapUsername',
            ConfigSource.db,
          ),
          samlAttrMapMail: await configManager.getConfig(
            'security:passport-saml:attrMapMail',
            ConfigSource.db,
          ),
          samlAttrMapFirstName: await configManager.getConfig(
            'security:passport-saml:attrMapFirstName',
            ConfigSource.db,
          ),
          samlAttrMapLastName: await configManager.getConfig(
            'security:passport-saml:attrMapLastName',
            ConfigSource.db,
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-saml:isSameUsernameTreatedAsIdenticalUser',
          ),
          isSameEmailTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-saml:isSameEmailTreatedAsIdenticalUser',
          ),
          samlABLCRule: await configManager.getConfig(
            'security:passport-saml:ABLCRule',
          ),
        };
        const parameters = {
          action: SupportedAction.ACTION_ADMIN_AUTH_SAML_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ securitySettingParams });
      } catch (err) {
        const msg = 'Error occurred in updating SAML setting';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-SAML-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/oidc:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/oidc
   *        description: Update OpenID Connect setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/OidcAuthSetting'
   *        responses:
   *          200:
   *            description: Succeeded to update OpenID Connect setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securitySettingParams:
   *                      $ref: '#/components/schemas/OidcAuthSetting'
   */
  router.put(
    '/oidc',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.oidcAuth,
    apiV3FormValidator,
    async (req, res) => {
      const requestParams = {
        'security:passport-oidc:providerName': req.body.oidcProviderName,
        'security:passport-oidc:issuerHost': req.body.oidcIssuerHost,
        'security:passport-oidc:authorizationEndpoint':
          req.body.oidcAuthorizationEndpoint,
        'security:passport-oidc:tokenEndpoint': req.body.oidcTokenEndpoint,
        'security:passport-oidc:revocationEndpoint':
          req.body.oidcRevocationEndpoint,
        'security:passport-oidc:introspectionEndpoint':
          req.body.oidcIntrospectionEndpoint,
        'security:passport-oidc:userInfoEndpoint':
          req.body.oidcUserInfoEndpoint,
        'security:passport-oidc:endSessionEndpoint':
          req.body.oidcEndSessionEndpoint,
        'security:passport-oidc:registrationEndpoint':
          req.body.oidcRegistrationEndpoint,
        'security:passport-oidc:jwksUri': req.body.oidcJWKSUri,
        'security:passport-oidc:clientId': req.body.oidcClientId,
        'security:passport-oidc:clientSecret': req.body.oidcClientSecret,
        'security:passport-oidc:attrMapId': req.body.oidcAttrMapId,
        'security:passport-oidc:attrMapUserName': req.body.oidcAttrMapUserName,
        'security:passport-oidc:attrMapName': req.body.oidcAttrMapName,
        'security:passport-oidc:attrMapMail': req.body.oidcAttrMapEmail,
        'security:passport-oidc:isSameUsernameTreatedAsIdenticalUser':
          req.body.isSameUsernameTreatedAsIdenticalUser,
        'security:passport-oidc:isSameEmailTreatedAsIdenticalUser':
          req.body.isSameEmailTreatedAsIdenticalUser,
      };

      try {
        await updateAndReloadStrategySettings('oidc', requestParams);

        const securitySettingParams = {
          oidcProviderName: await configManager.getConfig(
            'security:passport-oidc:providerName',
          ),
          oidcIssuerHost: await configManager.getConfig(
            'security:passport-oidc:issuerHost',
          ),
          oidcAuthorizationEndpoint: await configManager.getConfig(
            'security:passport-oidc:authorizationEndpoint',
          ),
          oidcTokenEndpoint: await configManager.getConfig(
            'security:passport-oidc:tokenEndpoint',
          ),
          oidcRevocationEndpoint: await configManager.getConfig(
            'security:passport-oidc:revocationEndpoint',
          ),
          oidcIntrospectionEndpoint: await configManager.getConfig(
            'security:passport-oidc:introspectionEndpoint',
          ),
          oidcUserInfoEndpoint: await configManager.getConfig(
            'security:passport-oidc:userInfoEndpoint',
          ),
          oidcEndSessionEndpoint: await configManager.getConfig(
            'security:passport-oidc:endSessionEndpoint',
          ),
          oidcRegistrationEndpoint: await configManager.getConfig(
            'security:passport-oidc:registrationEndpoint',
          ),
          oidcJWKSUri: await configManager.getConfig(
            'security:passport-oidc:jwksUri',
          ),
          oidcClientId: await configManager.getConfig(
            'security:passport-oidc:clientId',
          ),
          oidcClientSecret: await configManager.getConfig(
            'security:passport-oidc:clientSecret',
          ),
          oidcAttrMapId: await configManager.getConfig(
            'security:passport-oidc:attrMapId',
          ),
          oidcAttrMapUserName: await configManager.getConfig(
            'security:passport-oidc:attrMapUserName',
          ),
          oidcAttrMapName: await configManager.getConfig(
            'security:passport-oidc:attrMapName',
          ),
          oidcAttrMapEmail: await configManager.getConfig(
            'security:passport-oidc:attrMapMail',
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-oidc:isSameUsernameTreatedAsIdenticalUser',
          ),
          isSameEmailTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-oidc:isSameEmailTreatedAsIdenticalUser',
          ),
        };
        const parameters = {
          action: SupportedAction.ACTION_ADMIN_AUTH_OIDC_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ securitySettingParams });
      } catch (err) {
        const msg = 'Error occurred in updating OpenIDConnect';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-OpenIDConnect-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/google-oauth:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/google-oauth
   *        description: Update google OAuth
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/GoogleOAuthSetting'
   *        responses:
   *          200:
   *            description: Succeeded to google OAuth
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securitySettingParams:
   *                      $ref: '#/components/schemas/GoogleOAuthSetting'
   */
  router.put(
    '/google-oauth',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.googleOAuth,
    apiV3FormValidator,
    async (req, res) => {
      try {
        await updateAndReloadStrategySettings('google', {
          'security:passport-google:isSameEmailTreatedAsIdenticalUser':
            req.body.isSameEmailTreatedAsIdenticalUser,
        });
        await updateAndReloadStrategySettings(
          'google',
          {
            'security:passport-google:clientId': toNonBlankStringOrUndefined(
              req.body.googleClientId,
            ),
            'security:passport-google:clientSecret':
              toNonBlankStringOrUndefined(req.body.googleClientSecret),
          },
          { removeIfUndefined: true },
        );

        const securitySettingParams = {
          googleClientId: await configManager.getConfig(
            'security:passport-google:clientId',
          ),
          googleClientSecret: await configManager.getConfig(
            'security:passport-google:clientSecret',
          ),
          isSameEmailTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-google:isSameEmailTreatedAsIdenticalUser',
          ),
        };
        const parameters = {
          action: SupportedAction.ACTION_ADMIN_AUTH_GOOGLE_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ securitySettingParams });
      } catch (err) {
        const msg = 'Error occurred in updating googleOAuth';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-googleOAuth-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /security-setting/github-oauth:
   *      put:
   *        tags: [SecuritySetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /security-setting/github-oauth
   *        description: Update github OAuth
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/GitHubOAuthSetting'
   *        responses:
   *          200:
   *            description: Succeeded to github OAuth
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    securitySettingParams:
   *                      $ref: '#/components/schemas/GitHubOAuthSetting'
   */
  router.put(
    '/github-oauth',
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.githubOAuth,
    apiV3FormValidator,
    async (req, res) => {
      const requestParams = {
        'security:passport-github:clientId': req.body.githubClientId,
        'security:passport-github:clientSecret': req.body.githubClientSecret,
        'security:passport-github:isSameUsernameTreatedAsIdenticalUser':
          req.body.isSameUsernameTreatedAsIdenticalUser,
      };

      try {
        await updateAndReloadStrategySettings('github', requestParams);

        const securitySettingParams = {
          githubClientId: await configManager.getConfig(
            'security:passport-github:clientId',
          ),
          githubClientSecret: await configManager.getConfig(
            'security:passport-github:clientSecret',
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-github:isSameUsernameTreatedAsIdenticalUser',
          ),
        };
        const parameters = {
          action: SupportedAction.ACTION_ADMIN_AUTH_GITHUB_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ securitySettingParams });
      } catch (err) {
        // reset strategy
        await crowi.passportService.resetGitHubStrategy();
        const msg = 'Error occurred in updating githubOAuth';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-githubOAuth-failed'));
      }
    },
  );

  return router;
};
