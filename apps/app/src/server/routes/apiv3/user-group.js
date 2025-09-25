import { GroupType } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import express from 'express';
import {
  body, param, query, sanitizeQuery,
} from 'express-validator';

import { SupportedAction } from '~/interfaces/activity';
import { SCOPE } from '@growi/core/dist/interfaces';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { serializeUserGroupRelationSecurely } from '~/server/models/serializers/user-group-relation-serializer';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { excludeTestIdsFromTargetIds } from '~/server/util/compare-objectId';
import { toPagingLimit, toPagingOffset } from '~/server/util/express-validator/sanitizer';
import { generalXssFilter } from '~/services/general-xss-filter';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';


const logger = loggerFactory('growi:routes:apiv3:user-group'); // eslint-disable-line no-unused-vars

const router = express.Router();

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  const {
    User,
    Page,
  } = crowi.models;

  const validator = {
    create: [
      body('name', 'Group name is required').trim().exists({ checkFalsy: true }),
      body('description', 'Description must be a string').optional().isString(),
      body('parentId', 'ParentId must be a string').optional().isString(),
    ],
    update: [
      body('name', 'Group name must be a string').optional().trim().isString(),
      body('description', 'Group description must be a string').optional().isString(),
      body('parentId', 'ParentId must be a string or null').optional({ nullable: true }).isString(),
      body('forceUpdateParents', 'forceUpdateParents must be a boolean').optional().isBoolean(),
    ],
    delete: [
      param('id').trim().exists({ checkFalsy: true }),
      query('actionName').trim().exists({ checkFalsy: true }),
      query('transferToUserGroupId').trim(),
    ],
    listChildren: [
      query('parentIds', 'parentIds must be an array').optional().isArray(),
      query('includeGrandChildren', 'parentIds must be boolean').optional().isBoolean(),
    ],
    ancestorGroup: [
      query('groupId', 'groupId must be a string').optional().isString(),
    ],
    selectableGroups: [
      query('groupId', 'groupId must be a string').optional().isString(),
    ],
    users: {
      post: [
        param('id').trim().exists({ checkFalsy: true }),
        param('username').trim().exists({ checkFalsy: true }),
      ],
      delete: [
        param('id').trim().exists({ checkFalsy: true }),
        param('username').trim().exists({ checkFalsy: true }),
      ],
    },
    pages: {
      get: [
        param('id').trim().exists({ checkFalsy: true }),
        sanitizeQuery('limit').customSanitizer(toPagingLimit),
        sanitizeQuery('offset').customSanitizer(toPagingOffset),
      ],
    },
  };

  /**
   * @swagger
   *
   *  paths:
   *    /user-groups:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups
   *        description: Get usergroups
   *        parameters:
   *          - name: page
   *            in: query
   *            required: false
   *            description: page number
   *            schema:
   *              type: number
   *          - name: limit
   *            in: query
   *            required: false
   *            description: number of items per page
   *            schema:
   *              type: number
   *          - name: offset
   *            in: query
   *            required: false
   *            description: offset
   *            schema:
   *              type: number
   *          - name: pagination
   *            in: query
   *            required: false
   *            description: whether to paginate
   *            schema:
   *              type: boolean
   *        responses:
   *          200:
   *            description: usergroups are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userGroups:
   *                      type: object
   *                      description: a result of `UserGroup.find`
   *                    totalUserGroups:
   *                      type: number
   *                      description: the number of userGroups
   *                    pagingLimit:
   *                      type: number
   *                      description: the number of items per page
   */
  router.get('/', accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired, async(req, res) => {
    const { query } = req;

    try {
      const page = query.page != null ? parseInt(query.page) : undefined;
      const limit = query.limit != null ? parseInt(query.limit) : undefined;
      const offset = query.offset != null ? parseInt(query.offset) : undefined;
      const pagination = query.pagination != null ? query.pagination !== 'false' : undefined;

      const result = await UserGroup.findWithPagination({
        page, limit, offset, pagination,
      });
      const { docs: userGroups, totalDocs: totalUserGroups, limit: pagingLimit } = result;
      return res.apiv3({ userGroups, totalUserGroups, pagingLimit });
    }
    catch (err) {
      const msg = 'Error occurred in fetching user group list';
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(msg, 'user-group-list-fetch-failed'));
    }
  });

  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/ancestors:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/ancestors
   *        description: Get ancestor user groups.
   *        parameters:
   *          - name: groupId
   *            in: query
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: userGroups are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    ancestorUserGroups:
   *                      type: array
   *                      items:
   *                        type: object
   *                      description: userGroup objects
   */
  router.get('/ancestors',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.ancestorGroup,
    async(req, res) => {
      const { groupId } = req.query;

      try {
        const userGroup = await UserGroup.findOne({ _id: { $eq: groupId } });
        const ancestorUserGroups = await UserGroup.findGroupsWithAncestorsRecursively(userGroup);
        return res.apiv3({ ancestorUserGroups });
      }
      catch (err) {
        const msg = 'Error occurred while searching user groups';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-groups-search-failed'));
      }
    });

  /**
   * @swagger
   *    paths:
   *      /user-groups/children:
   *        get:
   *          tags: [UserGroups]
   *          security:
   *            - cookieAuth: []
   *          summary: /user-groups/children
   *          description: Get child user groups
   *          parameters:
   *            - name: parentIds
   *              in: query
   *              required: false
   *              description: IDs of parent user groups
   *              schema:
   *                type: array
   *                items:
   *                  type: string
   *            - name: includeGrandChildren
   *              in: query
   *              required: false
   *              description: Whether to include grandchild user groups
   *              schema:
   *                type: boolean
   *          responses:
   *            200:
   *              description: Child user groups are fetched
   *              content:
   *                application/json:
   *                  schema:
   *                    properties:
   *                      childUserGroups:
   *                        type: array
   *                        items:
   *                          type: object
   *                        description: Child user group objects
   *                      grandChildUserGroups:
   *                        type: array
   *                        items:
   *                          type: object
   *                        description: Grandchild user group objects
   */
  router.get('/children',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.listChildren,
    async(req, res) => {
      try {
        const { parentIds, includeGrandChildren = false } = req.query;

        const userGroupsResult = await UserGroup.findChildrenByParentIds(parentIds, includeGrandChildren);
        return res.apiv3({
          childUserGroups: userGroupsResult.childUserGroups,
          grandChildUserGroups: userGroupsResult.grandChildUserGroups,
        });
      }
      catch (err) {
        const msg = 'Error occurred in fetching child user group list';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'child-user-group-list-fetch-failed'));
      }
    });


  /**
   * @swagger
   *
   *  paths:
   *    /user-groups:
   *      post:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups
   *        description: Adds userGroup
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  name:
   *                    type: string
   *                    description: name of the userGroup trying to be added
   *                  description:
   *                    type: string
   *                    description: description of the userGroup trying to be added
   *                  parentId:
   *                    type: string
   *                    description: parentId of the userGroup trying to be added
   *        responses:
   *          200:
   *            description: userGroup is added
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userGroup:
   *                      type: object
   *                      description: A result of `UserGroup.createGroupByName`
   */
  router.post('/',
    accessTokenParser([SCOPE.WRITE.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    addActivity, validator.create, apiV3FormValidator,
    async(req, res) => {
      const { name, description = '', parentId } = req.body;

      try {
        const userGroupName = generalXssFilter.process(name);
        const userGroupDescription = generalXssFilter.process(description);
        const userGroup = await UserGroup.createGroup(userGroupName, userGroupDescription, parentId);

        const parameters = { action: SupportedAction.ACTION_ADMIN_USER_GROUP_CREATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ userGroup }, 201);
      }
      catch (err) {
        const msg = 'Error occurred in creating a user group';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-create-failed'));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /selectable-parent-groups:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /selectable-parent-groups
   *        description: Get selectable parent UserGroups
   *        parameters:
   *          - name: groupId
   *            in: query
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: userGroups are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    selectableParentGroups:
   *                      type: array
   *                      items:
   *                        type: object
   *                      description: userGroup objects
   */
  router.get('/selectable-parent-groups',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.selectableGroups,
    async(req, res) => {
      const { groupId } = req.query;

      try {
        const userGroup = await UserGroup.findOne({ _id: { $eq: groupId } });

        const descendantGroups = await UserGroup.findGroupsWithDescendantsRecursively([userGroup], []);
        const descendantGroupIds = descendantGroups.map(userGroups => userGroups._id.toString());

        const selectableParentGroups = await UserGroup.find({ _id: { $nin: [groupId, ...descendantGroupIds] } });
        return res.apiv3({ selectableParentGroups });
      }
      catch (err) {
        const msg = 'Error occurred while searching user groups';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-groups-search-failed'));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /selectable-child-groups:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /selectable-child-groups
   *        description: Get selectable child UserGroups
   *        parameters:
   *          - name: groupId
   *            in: query
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: userGroups are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    selectableChildGroups:
   *                      type: array
   *                      items:
   *                        type: object
   *                      description: userGroup objects
   */
  router.get('/selectable-child-groups',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.selectableGroups,
    async(req, res) => {
      const { groupId } = req.query;

      try {
        const userGroup = await UserGroup.findOne({ _id: { $eq: groupId } });

        const [ancestorGroups, descendantGroups] = await Promise.all([
          UserGroup.findGroupsWithAncestorsRecursively(userGroup, []),
          UserGroup.findGroupsWithDescendantsRecursively([userGroup], []),
        ]);

        const excludeUserGroupIds = [userGroup, ...ancestorGroups, ...descendantGroups].map(userGroups => userGroups._id.toString());
        const selectableChildGroups = await UserGroup.find({ _id: { $nin: excludeUserGroupIds } });
        return res.apiv3({ selectableChildGroups });
      }
      catch (err) {
        const msg = 'Error occurred while searching user groups';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-groups-search-failed'));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}
   *        description: Get UserGroup from Group ID
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *             type: string
   *        responses:
   *          200:
   *            description: userGroup are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userGroup:
   *                      type: object
   *                      description: userGroup object
   */
  router.get('/:id',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.selectableGroups,
    async(req, res) => {
      const { id: groupId } = req.params;

      try {
        const userGroup = await UserGroup.findById(groupId);
        return res.apiv3({ userGroup });
      }
      catch (err) {
        const msg = 'Error occurred while getting user group';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-groups-get-failed'));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}:
   *      delete:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}
   *        description: Deletes userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *          - name: actionName
   *            in: query
   *            description: name of action
   *            schema:
   *              type: string
   *          - name: transferToUserGroupId
   *            in: query
   *            description: userGroup id that will be transferred to
   *            schema:
   *              type: string
   *          - name: transferToUserGroupType
   *            in: query
   *            description: userGroup type that will be transferred to
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: userGroup is removed
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userGroups:
   *                      type: object
   *                      description: A result of `UserGroup.removeCompletelyById`
   */
  router.delete('/:id',
    accessTokenParser([SCOPE.WRITE.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.delete, apiV3FormValidator, addActivity,
    async(req, res) => {
      const { id: deleteGroupId } = req.params;
      const { actionName, transferToUserGroupId, transferToUserGroupType } = req.query;

      const transferToUserGroup = typeof transferToUserGroupId === 'string'
        && (transferToUserGroupType === GroupType.userGroup || transferToUserGroupType === GroupType.externalUserGroup)
        ? {
          item: transferToUserGroupId,
          type: transferToUserGroupType,
        } : undefined;

      try {
        const userGroups = await crowi.userGroupService.removeCompletelyByRootGroupId(deleteGroupId, actionName, req.user, transferToUserGroup);

        const parameters = { action: SupportedAction.ACTION_ADMIN_USER_GROUP_DELETE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ userGroups });
      }
      catch (err) {
        const msg = 'Error occurred while deleting user groups';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-groups-delete-failed'));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}:
   *      put:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}
   *        description: Update userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  name:
   *                    type: string
   *                    description: name of the userGroup trying to be updated
   *                  description:
   *                    type: string
   *                    description: description of the userGroup trying to be updated
   *                  parentId:
   *                    type: string
   *                    description: parentId of the userGroup trying to be updated
   *                  forceUpdateParents:
   *                    type: boolean
   *                    description: whether to update parent groups
   *        responses:
   *          200:
   *            description: userGroup is updated
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userGroup:
   *                      type: object
   *                      description: A result of `UserGroup.updateName`
   */
  router.put('/:id',
    accessTokenParser([SCOPE.WRITE.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.update, apiV3FormValidator, addActivity,
    async(req, res) => {
      const { id } = req.params;
      const {
        name, description, parentId, forceUpdateParents = false,
      } = req.body;

      try {
        const userGroup = await crowi.userGroupService.updateGroup(id, name, description, parentId, forceUpdateParents);

        const parameters = { action: SupportedAction.ACTION_ADMIN_USER_GROUP_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ userGroup });
      }
      catch (err) {
        const msg = 'Error occurred in updating a user group name';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-update-failed'));
      }
    });


  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}/users:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}/users
   *        description: Get users related to the userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: users are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    users:
   *                      type: array
   *                      items:
   *                        $ref: '#/components/schemas/User'
   *                      description: user objects
   */
  router.get('/:id/users',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    async(req, res) => {
      const { id } = req.params;

      try {
        const userGroup = await UserGroup.findById(id);
        const userGroupRelations = await UserGroupRelation.findAllRelationForUserGroup(userGroup);

        const serializeUsers = userGroupRelations.map((userGroupRelation) => {
          return serializeUserSecurely(userGroupRelation.relatedUser);
        });
        const users = serializeUsers.filter(user => user != null);

        return res.apiv3({ users });
      }
      catch (err) {
        const msg = `Error occurred in fetching users for group: ${id}`;
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-user-list-fetch-failed'));
      }
    });

  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}/unrelated-users:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}/unrelated-users
   *        description: Get users unrelated to the userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *          - name: searchWord
   *            in: query
   *            description: search word
   *            schema:
   *              type: string
   *          - name: searchType
   *            in: query
   *            description: search type
   *            schema:
   *              type: string
   *          - name: isAlsoNameSearched
   *            in: query
   *            description: whether name is also searched
   *            schema:
   *              type: boolean
   *          - name: isAlsoMailSearched
   *            in: query
   *            description: whether mail is also searched
   *            schema:
   *              type: boolean
   *        responses:
   *          200:
   *            description: users are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    users:
   *                      type: array
   *                      items:
   *                        $ref: '#/components/schemas/User'
   *                      description: user objects
   */
  router.get('/:id/unrelated-users',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    async(req, res) => {
      const { id } = req.params;
      const {
        searchWord, searchType, isAlsoNameSearched, isAlsoMailSearched,
      } = req.query;

      const queryOptions = {
        searchWord, searchType, isAlsoNameSearched, isAlsoMailSearched,
      };

      try {
        const userGroup = await UserGroup.findById(id);
        const users = await UserGroupRelation.findUserByNotRelatedGroup(userGroup, queryOptions);

        // return email only this api
        const serializedUsers = users.map((user) => {
          const { email } = user;
          const serializedUser = serializeUserSecurely(user);
          serializedUser.email = email;
          return serializedUser;
        });
        return res.apiv3({ users: serializedUsers });
      }
      catch (err) {
        const msg = `Error occurred in fetching unrelated users for group: ${id}`;
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-unrelated-user-list-fetch-failed'));
      }
    });


  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}/users/{username}:
   *      post:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}/users/{username}
   *        description: Add a user to the userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *          - name: username
   *            in: path
   *            required: true
   *            description: username of the user
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: a user is added
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    user:
   *                      $ref: '#/components/schemas/User'
   *                      description: the user added to the group
   *                    createdRelationCount:
   *                      type: number
   *                      description: the number of relations created
   */
  router.post('/:id/users/:username',
    accessTokenParser([SCOPE.WRITE.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.users.post, apiV3FormValidator, addActivity,
    async(req, res) => {
      const { id, username } = req.params;

      try {
        const [userGroup, user] = await Promise.all([
          UserGroup.findById(id),
          User.findUserByUsername(username),
        ]);

        const userGroups = await UserGroup.findGroupsWithAncestorsRecursively(userGroup);
        const userGroupIds = userGroups.map(g => g._id);

        // remove existing relations from list to create
        const existingRelations = await UserGroupRelation.find({ relatedGroup: { $in: userGroupIds }, relatedUser: user._id });
        const existingGroupIds = existingRelations.map(r => r.relatedGroup);
        const groupIdsToCreateRelation = excludeTestIdsFromTargetIds(userGroupIds, existingGroupIds);

        const insertedRelations = await UserGroupRelation.createRelations(groupIdsToCreateRelation, user);
        const serializedUser = serializeUserSecurely(user);

        const parameters = { action: SupportedAction.ACTION_ADMIN_USER_GROUP_ADD_USER };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ user: serializedUser, createdRelationCount: insertedRelations.length });
      }
      catch (err) {
        const msg = `Error occurred in adding the user "${username}" to group "${id}"`;
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-add-user-failed'));
      }
    });


  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}/users/{username}:
   *      delete:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}/users/{username}
   *        description: remove a user from the userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *          - name: username
   *            in: path
   *            required: true
   *            description: username of the user
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: a user was removed
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    user:
   *                      type: object
   *                      $ref: '#/components/schemas/User'
   *                      description: the user removed from the group
   *                    deletedGroupsCount:
   *                      type: number
   *                      description: the number of groups from which the user was removed
   */
  router.delete('/:id/users/:username',
    accessTokenParser([SCOPE.WRITE.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.users.delete, apiV3FormValidator,
    async(req, res) => {
      const { id: userGroupId, username } = req.params;

      try {
        const removedUserRes = await crowi.userGroupService.removeUserByUsername(userGroupId, username);
        const serializedUser = serializeUserSecurely(removedUserRes.user);

        return res.apiv3({ user: serializedUser, deletedGroupsCount: removedUserRes.deletedGroupsCount });
      }
      catch (err) {
        const msg = 'Error occurred while removing the user from groups.';
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-remove-user-failed'));
      }
    });


  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}/user-group-relations:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}/user-group-relations
   *        description: Get the user group relations for the userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: user group relations are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userGroupRelations:
   *                      type: array
   *                      items:
   *                        type: object
   *                      description: userGroupRelation objects
   */
  router.get('/:id/user-group-relations',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    async(req, res) => {
      const { id } = req.params;

      try {
        const userGroup = await UserGroup.findById(id);
        const userGroupRelations = await UserGroupRelation.findAllRelationForUserGroup(userGroup);
        const serialized = userGroupRelations.map(relation => serializeUserGroupRelationSecurely(relation));
        return res.apiv3({ userGroupRelations: serialized });
      }
      catch (err) {
        const msg = `Error occurred in fetching user group relations for group: ${id}`;
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-user-group-relation-list-fetch-failed'));
      }
    });


  /**
   * @swagger
   *
   *  paths:
   *    /user-groups/{id}/pages:
   *      get:
   *        tags: [UserGroups]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-groups/{id}/pages
   *        description: Get closed pages for the userGroup
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of userGroup
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: pages are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    pages:
   *                      type: array
   *                      items:
   *                        type: object
   *                      description: page objects
   */
  router.get('/:id/pages',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired,
    validator.pages.get, apiV3FormValidator,
    async(req, res) => {
      const { id } = req.params;
      const { limit, offset } = req.query;

      try {
        const { docs, totalDocs } = await Page.paginate({
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: {
            $elemMatch: {
              item: id,
            },
          },
        }, {
          offset,
          limit,
          populate: 'lastUpdateUser',
        });

        const current = offset / limit + 1;

        const pages = docs.map((doc) => {
          doc.lastUpdateUser = serializeUserSecurely(doc.lastUpdateUser);
          return doc;
        });

        // TODO: create a common moudule for paginated response
        return res.apiv3({ total: totalDocs, current, pages });
      }
      catch (err) {
        const msg = `Error occurred in fetching pages for group: ${id}`;
        logger.error(msg, err);
        return res.apiv3Err(new ErrorV3(msg, 'user-group-page-list-fetch-failed'));
      }
    });

  return router;
};
