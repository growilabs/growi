import path from 'path';

import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { userHomepagePath } from '@growi/core/dist/utils/page-path-utils';
import escapeStringRegexp from 'escape-string-regexp';
import express from 'express';
import { body, query } from 'express-validator';
import { isEmail } from 'validator';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import { deleteUserAiAssistant } from '~/features/openai/server/services/delete-ai-assistant';
import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import Activity from '~/server/models/activity';
import ExternalAccount from '~/server/models/external-account';
import { serializePageSecurely } from '~/server/models/serializers';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import { growiInfoService } from '~/server/service/growi-info';
import { deleteCompletelyUserHomeBySystem } from '~/server/service/page/delete-completely-user-home-by-system';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';

const logger = loggerFactory('growi:routes:apiv3:users');

const router = express.Router();

const PAGE_ITEMS = 50;

const validator = {};

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      User:
 *        description: User
 *        type: object
 *        properties:
 *          _id:
 *            type: string
 *            description: user ID
 *            example: 5ae5fccfc5577b0004dbd8ab
 *          lang:
 *            type: string
 *            description: language
 *            example: 'en_US'
 *          status:
 *            type: integer
 *            description: status
 *            example: 0
 *          admin:
 *            type: boolean
 *            description: whether the admin
 *            example: false
 *          email:
 *            type: string
 *            description: E-Mail address
 *            example: alice@aaa.aaa
 *          username:
 *            type: string
 *            description: username
 *            example: alice
 *          name:
 *            type: string
 *            description: full name
 *            example: Alice
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 *          imageUrlCached:
 *            type: string
 *            description: cached image URL
 *            example: /images/user/5ae5fccfc5577b0004dbd8ab/profile.jpg
 *          isEmailPublished:
 *            type: boolean
 *            description: whether the email is published
 *            example: false
 *          isGravatarEnabled:
 *            type: boolean
 *            description: whether the gravatar is enabled
 *            example: false
 *          isInvitationEmailSended:
 *            type: boolean
 *            description: whether the invitation email is sent
 *            example: false
 *          lastLoginAt:
 *            type: string
 *            description: datetime last login at
 *            example: 2010-01-01T00:00:00.000Z
 *          readOnly:
 *            type: boolean
 *            description: whether the user is read only
 *            example: false
 *          updatedAt:
 *            type: string
 *            description: datetime updated at
 *            example: 2010-01-01T00:00:00.000Z
 *          __v:
 *            type: integer
 *            description: DB record version
 *            example: 0
 */

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequired = require('../../middlewares/login-required')(crowi, true);
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  const {
    User,
    Page,
  } = crowi.models;


  const statusNo = {
    registered: User.STATUS_REGISTERED,
    active: User.STATUS_ACTIVE,
    suspended: User.STATUS_SUSPENDED,
    invited: User.STATUS_INVITED,
  };

  validator.statusList = [
    query('selectedStatusList').if(value => value != null).isArray().withMessage('selectedStatusList must be an array')
      .custom((value, { req }) => {
        const { user } = req;
        if (user != null && user.admin) {
          return value;
        }
        throw new Error('the param \'selectedStatusList\' is not allowed to use by the users except administrators');
      }),
    query('forceIncludeAttributes').if(value => value != null).isArray().withMessage('forceIncludeAttributes must be an array'),
    // validate sortOrder : asc or desc
    query('sortOrder').isIn(['asc', 'desc']),
    // validate sort : what column you will sort
    query('sort').isIn(['id', 'status', 'username', 'name', 'email', 'createdAt', 'lastLoginAt']),
    query('page').isInt({ min: 1 }),
    query('forceIncludeAttributes').toArray().custom((value, { req }) => {
      // only the admin user can specify forceIncludeAttributes
      if (value.length === 0) {
        return true;
      }
      return req.user.admin;
    }),
  ];

  validator.recentCreatedByUser = [
    query('limit').if(value => value != null).isInt({ max: 300 }).withMessage('You should set less than 300 or not to set limit.'),
  ];

  validator.usernames = [
    query('q').isString().withMessage('q is required'),
    query('offset').optional().isInt().withMessage('offset must be a number'),
    query('limit').optional().isInt({ max: 20 }).withMessage('You should set less than 20 or not to set limit.'),
    query('options').optional().isString().withMessage('options must be string'),
  ];

  // express middleware
  const certifyUserOperationOtherThenYourOwn = (req, res, next) => {
    const { id } = req.params;

    if (req.user._id.toString() === id) {
      const msg = 'This API is not available for your own users';
      logger.error(msg);
      return res.apiv3Err(new ErrorV3(msg), 400);
    }

    next();
  };

  const sendEmailByUserList = async(userList) => {
    const { appService, mailService } = crowi;
    const appTitle = appService.getAppTitle();
    const locale = configManager.getConfig('app:globalLang');
    const failedToSendEmailList = [];

    for (const user of userList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await mailService.send({
          to: user.email,
          subject: `Invitation to ${appTitle}`,
          template: path.join(crowi.localeDir, `${locale}/admin/userInvitation.ejs`),
          vars: {
            email: user.email,
            password: user.password,
            url: growiInfoService.getSiteUrl(),
            appTitle,
          },
        });
        // eslint-disable-next-line no-await-in-loop
        await User.updateIsInvitationEmailSended(user.user.id);
      }
      catch (err) {
        logger.error(err);
        failedToSendEmailList.push({
          email: user.email,
          reason: err.message,
        });
      }
    }

    return { failedToSendEmailList };
  };

  const sendEmailByUser = async(user) => {
    const { appService, mailService } = crowi;
    const appTitle = appService.getAppTitle();
    const locale = configManager.getConfig('app:globalLang');

    await mailService.send({
      to: user.email,
      subject: `New password for ${appTitle}`,
      template: path.join(crowi.localeDir, `${locale}/admin/userResetPassword.ejs`),
      vars: {
        email: user.email,
        password: user.password,
        url: growiInfoService.getSiteUrl(),
        appTitle,
      },
    });
  };

  /**
   * @swagger
   *
   *  paths:
   *    /users:
   *      get:
   *        tags: [Users]
   *        summary: /users
   *        description: Select selected columns from users order by asc or desc
   *        parameters:
   *          - name: page
   *            in: query
   *            description: page number
   *            schema:
   *              type: number
   *          - name: selectedStatusList
   *            in: query
   *            description: status list
   *            schema:
   *              type: string
   *          - name: searchText
   *            in: query
   *            description: For incremental search value from input box
   *            schema:
   *              type: string
   *          - name: sortOrder
   *            in: query
   *            description: asc or desc
   *            schema:
   *              type: string
   *          - name: sort
   *            in: query
   *            description: sorting column
   *            schema:
   *              type: string
   *          - name: forceIncludeAttributes
   *            in: query
   *            description: force include attributes
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: users are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    paginateResult:
   *                      $ref: '#/components/schemas/PaginateResult'
   */

  router.get('/',
    accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true }), loginRequired, validator.statusList, apiV3FormValidator, async(req, res) => {

      const page = parseInt(req.query.page) || 1;

      // status
      const forceIncludeAttributes = Array.isArray(req.query.forceIncludeAttributes)
        ? req.query.forceIncludeAttributes
        : [];
      const selectedStatusList = Array.isArray(req.query.selectedStatusList)
        ? req.query.selectedStatusList
        : ['active'];

      const statusNoList = (selectedStatusList.includes('all')) ? Object.values(statusNo) : selectedStatusList.map(element => statusNo[element]);

      // Search from input
      const searchText = req.query.searchText || '';
      const searchWord = new RegExp(escapeStringRegexp(searchText));
      // Sort
      const { sort, sortOrder } = req.query;
      const sortOutput = {
        [sort]: (sortOrder === 'desc') ? -1 : 1,
      };

      //  For more information about the external specification of the User API, see here (https://dev.growi.org/5fd7466a31d89500488248e3)

      const orConditions = [
        { name: { $in: searchWord } },
        { username: { $in: searchWord } },
      ];

      const query = {
        $and: [
          { status: { $in: statusNoList } },
          {
            $or: orConditions,
          },
        ],
      };

      try {
        if (req.user != null) {
          orConditions.push(
            {
              $and: [
                { isEmailPublished: true },
                { email: { $in: searchWord } },
              ],
            },
          );
        }
        if (forceIncludeAttributes.includes('email')) {
          orConditions.push({ email: { $in: searchWord } });
        }

        const paginateResult = await User.paginate(
          query,
          {
            sort: sortOutput,
            page,
            limit: PAGE_ITEMS,
          },
        );

        paginateResult.docs = paginateResult.docs.map((doc) => {

          // return email only when specified by query
          const { email } = doc;
          const user = serializeUserSecurely(doc);
          if (forceIncludeAttributes.includes('email')) {
            user.email = email;
          }

          return user;
        });

        return res.apiv3({ paginateResult });
      }
      catch (err) {
        const msg = 'Error occurred in fetching user group list';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-list-fetch-failed'), 500);
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/recent:
   *      get:
   *        tags: [Users]
   *        summary: /usersIdReacent
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of user
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: users recent created pages are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    paginateResult:
   *                      $ref: '#/components/schemas/PaginateResult'
   */
  router.get('/:id/recent', accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }), loginRequired,
    validator.recentCreatedByUser, apiV3FormValidator, async(req, res) => {
      const { id } = req.params;

      let user;

      try {
        user = await User.findById(id);
      }
      catch (err) {
        const msg = 'Error occurred in find user';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'retrieve-recent-created-pages-failed'), 500);
      }

      if (user == null) {
        return res.apiv3Err(new ErrorV3('find-user-is-not-found'));
      }

      const limit = parseInt(req.query.limit) || await configManager.getConfig('customize:showPageLimitationM') || 30;
      const page = req.query.page;
      const offset = (page - 1) * limit;
      const queryOptions = { offset, limit };

      try {
        const result = await Page.findListByCreator(user, req.user, queryOptions);

        result.pages = result.pages.map(page => serializePageSecurely(page));

        return res.apiv3(result);
      }
      catch (err) {
        const msg = 'Error occurred in retrieve recent created pages for user';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'retrieve-recent-created-pages-failed'), 500);
      }
    });

  validator.inviteEmail = [
    // isEmail prevents line breaks, so use isString
    body('shapedEmailList').custom((value) => {
      const array = value.filter((value) => { return isEmail(value) });
      if (array.length === 0) {
        throw new Error('At least one valid email address is required');
      }
      return array;
    }),
  ];

  /**
   * @swagger
   *
   *  paths:
   *    /users/invite:
   *      post:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/invite
   *        description: Create new users and send Emails
   *        parameters:
   *          - name: shapedEmailList
   *            in: query
   *            description: Invitation emailList
   *            schema:
   *              type: object
   *          - name: sendEmail
   *            in: query
   *            description: Whether to send mail
   *            schema:
   *              type: boolean
   *        responses:
   *          200:
   *            description: Inviting user success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    createdUserList:
   *                      $ref: '#/components/schemas/User'
   *                      description: Users successfully created
   *                    existingEmailList:
   *                      type: array
   *                      description: Users email that already exists
   *                      items:
   *                        type: string
   *                    failedEmailList:
   *                      type: object
   *                      description: Users email that failed to create or send email
   *                      properties:
   *                        email:
   *                          type: string
   *                          description: email address
   *                        reason:
   *                          type: string
   *                          description: reason for failure
   */
  router.post('/invite', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity,
    validator.inviteEmail, apiV3FormValidator,
    async(req, res) => {

      // Delete duplicate email addresses
      const emailList = Array.from(new Set(req.body.shapedEmailList));
      let failedEmailList = [];

      // Create users
      const createUser = await User.createUsersByEmailList(emailList);
      if (createUser.failedToCreateUserEmailList.length > 0) {
        failedEmailList = failedEmailList.concat(createUser.failedToCreateUserEmailList);
      }

      // Send email
      if (req.body.sendEmail) {
        const sendEmail = await sendEmailByUserList(createUser.createdUserList);
        if (sendEmail.failedToSendEmailList.length > 0) {
          failedEmailList = failedEmailList.concat(sendEmail.failedToSendEmailList);
        }
      }

      const parameters = { action: SupportedAction.ACTION_ADMIN_USERS_INVITE };
      activityEvent.emit('update', res.locals.activity._id, parameters);

      return res.apiv3({
        createdUserList: createUser.createdUserList,
        existingEmailList: createUser.existingEmailList,
        failedEmailList,
      }, 201);
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/grant-admin:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/{id}/grant-admin
   *        description: Grant user admin
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of user for admin
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Grant user admin success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      $ref: '#/components/schemas/User'
   *                      description: data of admin user
   */
  router.put('/:id/grant-admin', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity, async(req, res) => {
    const { id } = req.params;

    try {
      const userData = await User.findById(id);
      await userData.grantAdmin();

      const serializedUserData = serializeUserSecurely(userData);

      activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_GRANT_ADMIN });

      return res.apiv3({ userData: serializedUserData });
    }
    catch (err) {
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(err));
    }
  });

  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/revoke-admin:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/{id}/revoke-admin
   *        description: Revoke user admin
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of user for revoking admin
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Revoke user admin success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      type: object
   *                      description: data of revoked admin user
   */
  router.put('/:id/revoke-admin', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]),
    loginRequiredStrictly, adminRequired, certifyUserOperationOtherThenYourOwn, addActivity,
    async(req, res) => {
      const { id } = req.params;

      try {
        const userData = await User.findById(id);
        await userData.revokeAdmin();

        const serializedUserData = serializeUserSecurely(userData);

        activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_REVOKE_ADMIN });

        return res.apiv3({ userData: serializedUserData });
      }
      catch (err) {
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(err));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/grant-read-only:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/{id}/grant-read-only
   *        description: Grant user read only access
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of user for read only access
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Grant user read only access success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      $ref: '#/components/schemas/User'
   *                      description: data of grant read only
   */
  router.put('/:id/grant-read-only', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity,
    async(req, res) => {
      const { id } = req.params;

      try {
        const userData = await User.findById(id);

        if (userData == null) {
          return res.apiv3Err(new ErrorV3('User not found'), 404);
        }

        await userData.grantReadOnly();

        const serializedUserData = serializeUserSecurely(userData);

        activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_GRANT_READ_ONLY });

        return res.apiv3({ userData: serializedUserData });
      }
      catch (err) {
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(err));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/revoke-read-only:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/{id}/revoke-read-only
   *        description: Revoke user read only access
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of user for removing read only access
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Revoke user read only access success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      $ref: '#/components/schemas/User'
   *                      description: data of revoke read only
   */
  router.put('/:id/revoke-read-only', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity,
    async(req, res) => {
      const { id } = req.params;

      try {
        const userData = await User.findById(id);

        if (userData == null) {
          return res.apiv3Err(new ErrorV3('User not found'), 404);
        }

        await userData.revokeReadOnly();

        const serializedUserData = serializeUserSecurely(userData);

        activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_REVOKE_READ_ONLY });

        return res.apiv3({ userData: serializedUserData });
      }
      catch (err) {
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(err));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/activate:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/{id}/activate
   *        description: Activate user
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of activate user
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Activationg user success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      $ref: '#/components/schemas/User'
   *                      description: data of activate user
   */
  router.put('/:id/activate', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity, async(req, res) => {
    // check user upper limit
    const isUserCountExceedsUpperLimit = await User.isUserCountExceedsUpperLimit();
    if (isUserCountExceedsUpperLimit) {
      const msg = 'Unable to activate because user has reached limit';
      logger.error('Error', msg);
      return res.apiv3Err(new ErrorV3(msg));
    }

    const { id } = req.params;

    try {
      const userData = await User.findById(id);
      await userData.statusActivate();

      const serializedUserData = serializeUserSecurely(userData);

      activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_ACTIVATE });

      return res.apiv3({ userData: serializedUserData });
    }
    catch (err) {
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(err));
    }
  });
  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/deactivate:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/{id}/deactivate
   *        description: Deactivate user
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of deactivate user
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Deactivationg user success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userData:
   *                      $ref: '#/components/schemas/User'
   *                      description: data of deactivate user
   */
  router.put('/:id/deactivate', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]),
    loginRequiredStrictly, adminRequired, certifyUserOperationOtherThenYourOwn, addActivity,
    async(req, res) => {
      const { id } = req.params;

      try {
        const userData = await User.findById(id);
        await userData.statusSuspend();

        const serializedUserData = serializeUserSecurely(userData);

        activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_DEACTIVATE });

        return res.apiv3({ userData: serializedUserData });
      }
      catch (err) {
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(err));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/{id}/remove:
   *      delete:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/{id}/remove
   *        description: Delete user
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of delete user
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Deleting user success
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    user:
   *                      $ref: '#/components/schemas/User'
   *                      description: data of deleted user
   */
  router.delete('/:id/remove', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]),
    loginRequiredStrictly, adminRequired, certifyUserOperationOtherThenYourOwn, addActivity,
    async(req, res) => {
      const { id } = req.params;
      const isUsersHomepageDeletionEnabled = configManager.getConfig('security:user-homepage-deletion:isEnabled');
      const isForceDeleteUserHomepageOnUserDeletion = configManager.getConfig('security:user-homepage-deletion:isForceDeleteUserHomepageOnUserDeletion');

      try {
        const user = await User.findById(id);
        // !! DO NOT MOVE homepagePath FROM THIS POSITION !! -- 05.31.2023
        // catch username before delete user because username will be change to deleted_at_*
        const homepagePath = userHomepagePath(user);

        await UserGroupRelation.remove({ relatedUser: user });
        await ExternalUserGroupRelation.remove({ relatedUser: user });
        await user.statusDelete();
        await ExternalAccount.remove({ user });

        deleteUserAiAssistant(user);

        const serializedUser = serializeUserSecurely(user);

        activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_REMOVE });

        if (isUsersHomepageDeletionEnabled && isForceDeleteUserHomepageOnUserDeletion) {
          deleteCompletelyUserHomeBySystem(homepagePath, crowi.pageService);
        }

        return res.apiv3({ user: serializedUser });
      }
      catch (err) {
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(err));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/external-accounts:
   *      get:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/external-accounts
   *        description: Get external-account
   *        parameters:
   *          - name: page
   *            in: query
   *            description: page number
   *            schema:
   *              type: number
   *        responses:
   *          200:
   *            description: external-account are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    paginateResult:
   *                      $ref: '#/components/schemas/PaginateResult'
   */
  router.get('/external-accounts/', accessTokenParser([SCOPE.READ.USER_SETTINGS.EXTERNAL_ACCOUNT]), loginRequiredStrictly, adminRequired, async(req, res) => {
    const page = parseInt(req.query.page) || 1;
    try {
      const paginateResult = await ExternalAccount.findAllWithPagination({ page });
      return res.apiv3({ paginateResult });
    }
    catch (err) {
      const msg = 'Error occurred in fetching external-account list  ';
      logger.error(msg, err);
      return res.apiv3Err(new ErrorV3(msg + err.message, 'external-account-list-fetch-failed'), 500);
    }
  });

  /**
   * @swagger
   *
   *  paths:
   *    /users/external-accounts/{id}/remove:
   *      delete:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/external-accounts/{id}/remove
   *        description: Delete ExternalAccount
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of ExternalAccount
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description:  External Account is removed
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    externalAccount:
   *                      type: object
   *                      description: A result of `ExtenralAccount.findByIdAndRemove`
   */
  router.delete('/external-accounts/:id/remove', accessTokenParser([SCOPE.WRITE.USER_SETTINGS.EXTERNAL_ACCOUNT]),
    loginRequiredStrictly, adminRequired, apiV3FormValidator,
    async(req, res) => {
      const { id } = req.params;

      try {
        const externalAccount = await ExternalAccount.findByIdAndRemove(id);

        return res.apiv3({ externalAccount });
      }
      catch (err) {
        const msg = 'Error occurred in deleting a external account  ';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg + err.message, 'extenral-account-delete-failed'));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/update.imageUrlCache:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/update.imageUrlCache
   *        description: update imageUrlCache
   *        requestBody:
   *          content:
   *           application/json:
   *            schema:
   *             properties:
   *              userIds:
   *                type: array
   *                description: user id list
   *                items:
   *                  type: string
   *        responses:
   *          200:
   *            description: success creating imageUrlCached
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  description: success creating imageUrlCached
   */
  router.put('/update.imageUrlCache', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, async(req, res) => {
    try {
      const userIds = req.body.userIds;
      const users = await User.find({ _id: { $in: userIds }, imageUrlCached: null });
      const requests = await Promise.all(users.map(async(user) => {
        return {
          updateOne: {
            filter: { _id: user._id },
            update: { $set: { imageUrlCached: await user.generateImageUrlCached() } },
          },
        };
      }));

      if (requests.length > 0) {
        await User.bulkWrite(requests);
      }

      return res.apiv3({});
    }
    catch (err) {
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(err));
    }
  });

  /**
   * @swagger
   *
   *  paths:
   *    /users/reset-password:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/reset-password
   *        description: update imageUrlCache
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  id:
   *                    type: string
   *                    description: user id for reset password
   *        responses:
   *          200:
   *            description: success reset password
   *            content:
   *              application/json:
   *                schema:
   *                 properties:
   *                  newPassword:
   *                    type: string
   *                    description: new password
   *                  user:
   *                    $ref: '#/components/schemas/User'
   */
  router.put('/reset-password', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity, async(req, res) => {
    const { id } = req.body;

    try {
      const [newPassword, user] = await Promise.all([
        await User.resetPasswordByRandomString(id),
        await User.findById(id)]);

      activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_PASSWORD_RESET });
      return res.apiv3({ newPassword, user });
    }
    catch (err) {
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(err));
    }
  });

  /**
   * @swagger
   *
   *  paths:
   *    /users/reset-password-email:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/reset-password-email
   *        description: send new password email
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  id:
   *                    type: string
   *                    description: user id for send new password email
   *                  newPassword:
   *                    type: string
   *        responses:
   *          200:
   *            description: success send new password email
   */
  router.put('/reset-password-email', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity,
    async(req, res) => {
      const { id } = req.body;

      try {
        const user = await User.findById(id);
        if (user == null) {
          throw new Error('User not found');
        }
        const userInfo = {
          email: user.email,
          password: req.body.newPassword,
        };

        await sendEmailByUser(userInfo);
        return res.apiv3();
      }
      catch (err) {
        const msg = err.message;
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /users/send-invitation-email:
   *      put:
   *        tags: [Users Management]
   *        security:
   *          - cookieAuth: []
   *        summary: /users/send-invitation-email
   *        description: send invitation email
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  id:
   *                    type: string
   *                    description: user id for send invitation email
   *        responses:
   *          200:
   *            description: success send invitation email
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    failedToSendEmail:
   *                      type: object
   *                      description: email and reasons for email sending failure
   *                      properties:
   *                        email:
   *                          type: string
   *                        reason:
   *                          type: string
   */
  router.put('/send-invitation-email', accessTokenParser([SCOPE.WRITE.ADMIN.USER_MANAGEMENT]), loginRequiredStrictly, adminRequired, addActivity,
    async(req, res) => {
      const { id } = req.body;

      try {
        const user = await User.findById(id);
        const newPassword = await User.resetPasswordByRandomString(id);
        const userList = [{
          email: user.email,
          password: newPassword,
          user: { id },
        }];
        const sendEmail = await sendEmailByUserList(userList);
        // return null if absent

        activityEvent.emit('update', res.locals.activity._id, { action: SupportedAction.ACTION_ADMIN_USERS_SEND_INVITATION_EMAIL });

        return res.apiv3({ failedToSendEmail: sendEmail.failedToSendEmailList[0] });
      }
      catch (err) {
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(err));
      }
    });

  /**
   * @swagger
   *
   *    paths:
   *      /users/list:
   *        get:
   *          tags: [Users]
   *          summary: /users/list
   *          description: Get list of users
   *          parameters:
   *            - in: query
   *              name: userIds
   *              schema:
   *                type: string
   *                description: user IDs
   *                example: 5e06fcc7516d64004dbf4da6,5e098d53baa2ac004e7d24ad
   *          responses:
   *            200:
   *              description: Succeeded to get list of users.
   *              content:
   *                application/json:
   *                  schema:
   *                    properties:
   *                      users:
   *                        type: array
   *                        items:
   *                          $ref: '#/components/schemas/User'
   *                        description: user list
   *            403:
   *              $ref: '#/components/responses/Forbidden'
   *            500:
   *              $ref: '#/components/responses/InternalServerError'
   */
  router.get('/list', accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true }), loginRequired, async(req, res) => {
    const userIds = req.query.userIds ?? null;

    let userFetcher;
    if (userIds != null && userIds.split(',').length > 0) {
      userFetcher = User.findUsersByIds(userIds.split(','));
    }
    else {
      userFetcher = User.findAllUsers();
    }

    const data = {};
    try {
      const users = await userFetcher;
      data.users = users.map((user) => {
        // omit email
        if (user.isEmailPublished !== true) { // compare to 'true' because Crowi original data doesn't have 'isEmailPublished'
          user.email = undefined;
        }
        return user.toObject({ virtuals: true });
      });
    }
    catch (err) {
      return res.apiv3Err(new ErrorV3(err));
    }

    return res.apiv3(data);
  });

  /**
    * @swagger
    *
    *    paths:
    *      /users/usernames:
    *        get:
    *          tags: [Users]
    *          summary: /users/usernames
    *          description: Get list of usernames
    *          parameters:
    *            - in: query
    *              name: q
    *              schema:
    *                type: string
    *                description: query string to search usernames
    *                example: alice
    *            - in: query
    *              name: offset
    *              schema:
    *                type: integer
    *                description: offset for pagination
    *                example: 0
    *            - in: query
    *              name: limit
    *              schema:
    *                type: integer
    *                description: limit for pagination
    *                example: 10
    *            - in: query
    *              name: options
    *              schema:
    *                type: string
    *                description: options for including different types of users
    *                example: '{"isIncludeActiveUser": true, "isIncludeInactiveUser": true,
    *                          "isIncludeActivitySnapshotUser": true, "isIncludeMixedUsernames": true}'
    *          responses:
    *            200:
    *              description: Succeeded to get list of usernames.
    *              content:
    *                application/json:
    *                  schema:
    *                    properties:
    *                      activeUser:
    *                        type: object
    *                        properties:
    *                          usernames:
    *                            type: array
    *                            items:
    *                              type: string
    *                          totalCount:
    *                            type: integer
    *                      inactiveUser:
    *                        type: object
    *                        properties:
    *                          usernames:
    *                            type: array
    *                            items:
    *                              type: string
    *                          totalCount:
    *                            type: integer
    *                      activitySnapshotUser:
    *                        type: object
    *                        properties:
    *                          usernames:
    *                            type: array
    *                            items:
    *                              type: string
    *                          totalCount:
    *                            type: integer
    *                      mixedUsernames:
    *                        type: array
    *                        items:
    *                          type: string
    */
  router.get('/usernames',
    accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true }), loginRequired, validator.usernames, apiV3FormValidator, async(req, res) => {
      const q = req.query.q;
      const offset = +req.query.offset || 0;
      const limit = +req.query.limit || 10;

      try {
        const options = JSON.parse(req.query.options || '{}');
        const data = {};

        if (options.isIncludeActiveUser == null || options.isIncludeActiveUser) {
          const activeUserData = await User.findUserByUsernameRegexWithTotalCount(q, [User.STATUS_ACTIVE], { offset, limit });
          const activeUsernames = activeUserData.users.map(user => user.username);
          Object.assign(data, { activeUser: { usernames: activeUsernames, totalCount: activeUserData.totalCount } });
        }

        if (options.isIncludeInactiveUser) {
          const inactiveUserStates = [User.STATUS_REGISTERED, User.STATUS_SUSPENDED, User.STATUS_INVITED];
          const inactiveUserData = await User.findUserByUsernameRegexWithTotalCount(q, inactiveUserStates, { offset, limit });
          const inactiveUsernames = inactiveUserData.users.map(user => user.username);
          Object.assign(data, { inactiveUser: { usernames: inactiveUsernames, totalCount: inactiveUserData.totalCount } });
        }

        if (options.isIncludeActivitySnapshotUser && req.user.admin) {
          const activitySnapshotUserData = await Activity.findSnapshotUsernamesByUsernameRegexWithTotalCount(q, { offset, limit });
          Object.assign(data, { activitySnapshotUser: activitySnapshotUserData });
        }

        // eslint-disable-next-line max-len
        const canIncludeMixedUsernames = (options.isIncludeMixedUsernames && req.user.admin) || (options.isIncludeMixedUsernames && !options.isIncludeActivitySnapshotUser);
        if (canIncludeMixedUsernames) {
          const allUsernames = [...data.activeUser?.usernames || [], ...data.inactiveUser?.usernames || [], ...data?.activitySnapshotUser?.usernames || []];
          const distinctUsernames = Array.from(new Set(allUsernames));
          Object.assign(data, { mixedUsernames: distinctUsernames });
        }

        return res.apiv3(data);
      }
      catch (err) {
        logger.error('Failed to get usernames', err);
        return res.apiv3Err(err);
      }
    });

  return router;
};
