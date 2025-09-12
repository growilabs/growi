import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { body } from 'express-validator';


import { i18n } from '^/config/next-i18next.config';

import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../../middlewares/add-activity';
import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import EditorSettings from '../../../models/editor-settings';
import ExternalAccount from '../../../models/external-account';
import InAppNotificationSettings from '../../../models/in-app-notification-settings';

import { deleteAccessTokenHandlersFactory } from './delete-access-token';
import { deleteAllAccessTokensHandlersFactory } from './delete-all-access-tokens';
import { generateAccessTokenHandlerFactory } from './generate-access-token';
import { getAccessTokenHandlerFactory } from './get-access-tokens';


const logger = loggerFactory('growi:routes:apiv3:personal-setting');

const express = require('express');
const passport = require('passport');

const router = express.Router();

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      PersonalSettings:
 *        description: personal settings
 *        type: object
 *        properties:
 *          name:
 *            type: string
 *          email:
 *            type: string
 *          lang:
 *            type: string
 *          isEmailPublished:
 *            type: boolean
 *          slackMemberId:
 *            type: string
 *      Passwords:
 *        description: passwords for update
 *        type: object
 *        properties:
 *          oldPassword:
 *            type: string
 *          newPassword:
 *            type: string
 *          newPasswordConfirm:
 *            type: string
 *      AssociateUser:
 *        description: Ldap account for associate
 *        type: object
 *        properties:
 *          username:
 *            type: string
 *          password:
 *            type: string
 *      DisassociateUser:
 *        description: Ldap account for disassociate
 *        type: object
 *        properties:
 *          providerType:
 *            type: string
 *          accountId:
 *            type: string
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../../middlewares/login-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const { User } = crowi.models;

  const activityEvent = crowi.event('activity');

  const minPasswordLength = crowi.configManager.getConfig('app:minPasswordLength');

  const validator = {
    personal: [
      body('name').isString().not().isEmpty(),
      body('email')
        .isEmail()
        .custom((email) => {
          if (!User.isEmailValid(email)) throw new Error('email is not included in whitelist');
          return true;
        }),
      body('lang').isString().isIn(i18n.locales),
      body('isEmailPublished').isBoolean(),
      body('slackMemberId').optional().isString(),
    ],
    imageType: [
      body('isGravatarEnabled').isBoolean(),
    ],
    password: [
      body('oldPassword').isString(),
      body('newPassword').isString().not().isEmpty()
        .isLength({ min: minPasswordLength })
        .withMessage(`password must be at least ${minPasswordLength} characters long`),
      body('newPasswordConfirm').isString().not().isEmpty()
        .custom((value, { req }) => {
          return (value === req.body.newPassword);
        }),
    ],
    associateLdap: [
      body('username').isString().not().isEmpty(),
      body('password').isString().not().isEmpty(),
    ],
    disassociateLdap: [
      body('providerType').isString().not().isEmpty(),
      body('accountId').isString().not().isEmpty(),
    ],
    editorSettings: [
      body('theme').optional().isString(),
      body('keymapMode').optional().isString(),
      body('styleActiveLine').optional().isBoolean(),
      body('autoFormatMarkdownTable').optional().isBoolean(),
    ],
    inAppNotificationSettings: [
      body('defaultSubscribeRules.*.name').isString(),
      body('defaultSubscribeRules.*.isEnabled').optional().isBoolean(),
    ],
  };

  /**
   * @swagger
   *
   *    /personal-setting:
   *      get:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting
   *        description: Get personal parameters
   *        responses:
   *          200:
   *            description: params of personal
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    currentUser:
   *                      type: object
   *                      description: personal params
   */
  router.get('/', accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true }), loginRequiredStrictly, async(req, res) => {
    const { username } = req.user;
    try {
      const user = await User.findUserByUsername(username);

      // return email and apiToken
      const { email, apiToken } = user;
      const currentUser = user.toObject();
      currentUser.email = email;
      currentUser.apiToken = apiToken;

      return res.apiv3({ currentUser });
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err('update-personal-settings-failed');
    }
  });

  /**
   * @swagger
   *
   *    /personal-setting/is-password-set:
   *      get:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting
   *        description: Get whether a password has been set
   *        responses:
   *          200:
   *            description: Whether a password has been set
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    isPasswordSet:
   *                      type: boolean
   *                      description: Whether a password has been set
   *                    minPasswordLength:
   *                      type: number
   *                      description: Minimum password length
   */
  router.get('/is-password-set', accessTokenParser([SCOPE.READ.USER_SETTINGS.PASSWORD], { acceptLegacy: true }), loginRequiredStrictly, async(req, res) => {
    const { username } = req.user;

    try {
      const user = await User.findUserByUsername(username);
      const isPasswordSet = user.isPasswordSet();
      const minPasswordLength = crowi.configManager.getConfig('app:minPasswordLength');
      return res.apiv3({ isPasswordSet, minPasswordLength });
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err('fail-to-get-whether-password-is-set');
    }

  });

  /**
   * @swagger
   *
   *    /personal-setting:
   *      put:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting
   *        description: Update personal setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/PersonalSettings'
   *        responses:
   *          200:
   *            description: params of personal
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    updatedUser:
   *                      type: object
   *                      description: personal params
   */
  router.put('/',
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.INFO], { acceptLegacy: true }), loginRequiredStrictly, addActivity, validator.personal, apiV3FormValidator,
    async(req, res) => {

      try {
        const user = await User.findOne({ _id: req.user.id });
        user.name = req.body.name;
        user.email = req.body.email;
        user.lang = req.body.lang;
        user.isEmailPublished = req.body.isEmailPublished;
        user.slackMemberId = req.body.slackMemberId;

        const isUniqueEmail = await user.isUniqueEmail();

        if (!isUniqueEmail) {
          logger.error('email-is-not-unique');
          return res.apiv3Err(new ErrorV3('The email is already in use', 'email-is-already-in-use'));
        }

        const updatedUser = await user.save();

        const parameters = { action: SupportedAction.ACTION_USER_PERSONAL_SETTINGS_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ updatedUser });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('update-personal-settings-failed');
      }

    });

  /**
   * @swagger
   *
   *    /personal-setting/image-type:
   *      put:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting/image-type
   *        description: Update user image type
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  isGravatarEnabled:
   *                    type: boolean
   *        responses:
   *          200:
   *            description: succeded to update user image type
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      type: object
   *                      description: user data
   */
  router.put('/image-type', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.INFO], { acceptLegacy: true }), loginRequiredStrictly, addActivity,
    validator.imageType, apiV3FormValidator,
    async(req, res) => {
      const { isGravatarEnabled } = req.body;

      try {
        const userData = await req.user.updateIsGravatarEnabled(isGravatarEnabled);

        const parameters = { action: SupportedAction.ACTION_USER_IMAGE_TYPE_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ userData });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('update-personal-settings-failed');
      }
    });

  /**
   * @swagger
   *
   *    /personal-setting/external-accounts:
   *      get:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting/external-accounts
   *        description: Get external accounts that linked current user
   *        responses:
   *          200:
   *            description: external accounts
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    externalAccounts:
   *                      type: object
   *                      description: array of external accounts
   */
  router.get('/external-accounts',
    accessTokenParser([SCOPE.READ.USER_SETTINGS.EXTERNAL_ACCOUNT], { acceptLegacy: true }), loginRequiredStrictly, async(req, res) => {
      const userData = req.user;

      try {
        const externalAccounts = await ExternalAccount.find({ user: userData });
        return res.apiv3({ externalAccounts });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('get-external-accounts-failed');
      }

    });

  /**
   * @swagger
   *
   *    /personal-setting/password:
   *      put:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting/password
   *        description: Update user password
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  oldPassword:
   *                    type: string
   *                  newPassword:
   *                    type: string
   *        responses:
   *          200:
   *            description: user password
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      type: object
   *                      description: user data updated
   */
  router.put('/password',
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.PASSWORD], { acceptLegacy: true }), loginRequiredStrictly, addActivity, validator.password, apiV3FormValidator,
    async(req, res) => {
      const { body, user } = req;
      const { oldPassword, newPassword } = body;

      if (user.isPasswordSet() && !user.isPasswordValid(oldPassword)) {
        return res.apiv3Err('wrong-current-password', 400);
      }
      try {
        const userData = await user.updatePassword(newPassword);

        const parameters = { action: SupportedAction.ACTION_USER_PASSWORD_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ userData });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('update-password-failed');
      }

    });

  /**
   * @swagger
   *
   *    /personal-setting/api-token:
   *      put:
   *        tags: [GeneralSetting]
   *        security:
   *          - cookieAuth: []
   *        summary: /personal-setting/api-token
   *        description: Update user api token
   *        responses:
   *          200:
   *            description: succeded to update user api token
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      type: object
   *                      description: user data
   */
  router.put('/api-token', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.API.API_TOKEN]), loginRequiredStrictly, addActivity, async(req, res) => {
    const { user } = req;

    try {
      const userData = await user.updateApiToken();

      const parameters = { action: SupportedAction.ACTION_USER_API_TOKEN_UPDATE };
      activityEvent.emit('update', res.locals.activity._id, parameters);

      return res.apiv3({ userData });
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err('update-api-token-failed');
    }

  });

  /**
   * @swagger
   *   /personal-setting/access-token:
   *     get:
   *       tags: [GeneralSetting]
   *       operationId: getAccessToken
   *       summary: /personal-setting/access-token
   *       description: Get access token
   *       responses:
   *         200:
   *           description: succded to get access token
   *           content:
   *             application/json:
   *               schema:
   *                 properties:
   *                   accessTokens:
   *                     type: object
   *                     description: array of access tokens
   */
  router.get('/access-token', accessTokenParser([SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN]), getAccessTokenHandlerFactory(crowi));

  /**
   * @swagger
   *   /personal-setting/access-token:
   *     post:
   *       tags: [GeneralSetting]
   *       operationId: generateccessToken
   *       summary: /personal-setting/access-token
   *       description: Generate access token
   *       responses:
   *         200:
   *           description: succeded to create access token
   *           content:
   *             application/json:
   *               schema:
   *                 properties:
   *                   _id:
   *                     type: string
   *                     description: id of access token
   *                   token:
   *                     type: string
   *                     description: access token
   *                   expiredAt:
   *                     type: string
   *                     description: expired date
   *                   description:
   *                     type: string
   *                     description: description of access token
   *                   scope:
   *                     type: array
   *                     description: scope of access token
   *                     items:
   *                      type: string
   */
  router.post('/access-token', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN]), generateAccessTokenHandlerFactory(crowi));

  /**
   * @swagger
   *   /personal-setting/access-token/:
   *     delete:
   *       tags: [GeneralSetting]
   *       operationId: deleteAccessToken
   *       summary: /personal-setting/access-token
   *       description: Delete access token
   *       responses:
   *         200:
   *           description: succeded to delete access token
   *
   */
  router.delete('/access-token', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN]), deleteAccessTokenHandlersFactory(crowi));

  /**
   * @swagger
   *   /personal-setting/access-token/all:
   *     delete:
   *       tags: [GeneralSetting]
   *       operationId: deleteAllAccessToken
   *       summary: /personal-setting/access-token/all
   *       description: Delete all access tokens
   *       responses:
   *         200:
   *           description: succeded to delete all access tokens
   */
  router.delete('/access-token/all', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN]), deleteAllAccessTokensHandlersFactory(crowi));

  /**
   * @swagger
   *
   *    /personal-setting/associate-ldap:
   *      put:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting/associate-ldap
   *        description: associate Ldap account
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  username:
   *                    type: string
   *        responses:
   *          200:
   *            description: succeded to associate Ldap account
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    associateUser:
   *                      type: object
   *                      description: Ldap account associate to me
   */
  router.put('/associate-ldap', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.EXTERNAL_ACCOUNT]), loginRequiredStrictly, addActivity,
    validator.associateLdap, apiV3FormValidator,
    async(req, res) => {
      const { passportService } = crowi;
      const { user, body } = req;
      const { username } = body;

      if (!passportService.isLdapStrategySetup) {
        logger.error('LdapStrategy has not been set up');
        return res.apiv3Err('associate-ldap-account-failed', 405);
      }

      try {
        await passport.authenticate('ldapauth');
        const associateUser = await ExternalAccount.associate('ldap', username, user);

        const parameters = { action: SupportedAction.ACTION_USER_LDAP_ACCOUNT_ASSOCIATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ associateUser });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('associate-ldap-account-failed');
      }

    });

  /**
   * @swagger
   *
   *    /personal-setting/disassociate-ldap:
   *      put:
   *        tags: [GeneralSetting]
   *        summary: /personal-setting/disassociate-ldap
   *        description: disassociate Ldap account
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/DisassociateUser'
   *        responses:
   *          200:
   *            description: succeded to disassociate Ldap account
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    disassociateUser:
   *                      type: object
   *                      description: Ldap account disassociate to me
   */
  router.put('/disassociate-ldap',
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.EXTERNAL_ACCOUNT]), loginRequiredStrictly, addActivity, validator.disassociateLdap, apiV3FormValidator,
    async(req, res) => {
      const { user, body } = req;
      const { providerType, accountId } = body;

      try {
        const count = await ExternalAccount.count({ user });
        // make sure password set or this user has two or more ExternalAccounts
        if (user.password == null && count <= 1) {
          return res.apiv3Err('disassociate-ldap-account-failed');
        }
        const disassociateUser = await ExternalAccount.findOneAndRemove({
          providerType: { $eq: providerType },
          accountId: { $eq: accountId },
          user,
        });

        const parameters = { action: SupportedAction.ACTION_USER_LDAP_ACCOUNT_DISCONNECT };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ disassociateUser });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('disassociate-ldap-account-failed');
      }

    });

  /**
   * @swagger
   *
   *    /personal-setting/editor-settings:
   *      put:
   *        tags: [EditorSetting]
   *        summary: /personal-setting/editor-settings
   *        description: Put editor preferences
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  theme:
   *                    type: string
   *                  keymapMode:
   *                    type: string
   *                  styleActiveLine:
   *                    type: boolean
   *                  autoFormatMarkdownTable:
   *                    type: boolean
   *        responses:
   *          200:
   *            description: params of editor settings
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  description: editor settings
   */
  router.put('/editor-settings', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.OTHER]), loginRequiredStrictly,
    addActivity, validator.editorSettings, apiV3FormValidator,
    async(req, res) => {
      const query = { userId: req.user.id };
      const { body } = req;

      const {
        theme, keymapMode, styleActiveLine, autoFormatMarkdownTable,
      } = body;

      const document = {
        theme, keymapMode, styleActiveLine, autoFormatMarkdownTable,
      };

      // Insert if document does not exist, and return new values
      // See: https://mongoosejs.com/docs/api.html#model_Model.findOneAndUpdate
      const options = { upsert: true, new: true };
      try {
        const response = await EditorSettings.findOneAndUpdate(query, { $set: document }, options);

        const parameters = { action: SupportedAction.ACTION_USER_EDITOR_SETTINGS_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3(response);
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('updating-editor-settings-failed');
      }
    });


  /**
   * @swagger
   *
   *    /personal-setting/editor-settings:
   *      get:
   *        tags: [EditorSetting]
   *        summary: /personal-setting/editor-settings
   *        description: Get editor preferences
   *        responses:
   *          200:
   *            description: params of editor settings
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  description: editor settings
   */
  router.get('/editor-settings', accessTokenParser([SCOPE.READ.USER_SETTINGS.OTHER]), loginRequiredStrictly, async(req, res) => {
    try {
      const query = { userId: req.user.id };
      const editorSettings = await EditorSettings.findOne(query) ?? new EditorSettings();
      return res.apiv3(editorSettings);
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err('getting-editor-settings-failed');
    }
  });

  /**
   * @swagger
   *
   *    /personal-setting/in-app-notification-settings:
   *      put:
   *        tags: [InAppNotificationSettings]
   *        summary: /personal-setting/in-app-notification-settings
   *        description: Put InAppNotificationSettings
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  subscribeRules:
   *                    type: array
   *                    items:
   *                      type: object
   *                      properties:
   *                        name:
   *                          type: string
   *                        isEnabled:
   *                          type: boolean
   *        responses:
   *          200:
   *            description: params of InAppNotificationSettings
   *            content:
   *              application/json:
   *                schema:
   *                 type: object
   */
  router.put('/in-app-notification-settings',
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.IN_APP_NOTIFICATION]),
    loginRequiredStrictly, addActivity, validator.inAppNotificationSettings, apiV3FormValidator, async(req, res) => {
      const query = { userId: req.user.id };
      const subscribeRules = req.body.subscribeRules;

      if (subscribeRules == null) {
        return res.apiv3Err('no-rules-found');
      }

      const options = { upsert: true, new: true, runValidators: true };
      try {
        const response = await InAppNotificationSettings.findOneAndUpdate(query, { $set: { subscribeRules } }, options);

        const parameters = { action: SupportedAction.ACTION_USER_IN_APP_NOTIFICATION_SETTINGS_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3(response);
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err('updating-in-app-notification-settings-failed');
      }
    });

  /**
   * @swagger
   *
   *    /personal-setting/in-app-notification-settings:
   *      get:
   *        tags: [InAppNotificationSettings]
   *        summary: personal-setting/in-app-notification-settings
   *        description: Get InAppNotificationSettings
   *        responses:
   *          200:
   *            description: params of InAppNotificationSettings
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    currentUser:
   *                      type: object
   *                      description: InAppNotificationSettings
   */
  router.get('/in-app-notification-settings', accessTokenParser([SCOPE.READ.USER_SETTINGS.IN_APP_NOTIFICATION]), loginRequiredStrictly, async(req, res) => {
    const query = { userId: req.user.id };
    try {
      const response = await InAppNotificationSettings.findOne(query);
      return res.apiv3(response);
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err('getting-in-app-notification-settings-failed');
    }
  });

  return router;
};
