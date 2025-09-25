import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';

import { SCOPE } from '@growi/core/dist/interfaces';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { serializeUserGroupRelationSecurely } from '~/server/models/serializers';
import UserGroupRelation from '~/server/models/user-group-relation';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:user-group-relation'); // eslint-disable-line no-unused-vars

const { query } = require('express-validator');

const router = express.Router();

const validator = {};

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);

  validator.list = [
    query('groupIds', 'groupIds is required and must be an array').isArray(),
    query('childGroupIds', 'childGroupIds must be an array').optional().isArray(),
  ];

  /**
   * @swagger
   *  paths:
   *    /user-group-relations:
   *      get:
   *        tags: [UserGroupRelations]
   *        security:
   *          - cookieAuth: []
   *        summary: /user-group-relations
   *        description: Gets the user group relations
   *        responses:
   *          200:
   *            description: user group relations are fetched
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    userGroupRelations:
   *                      type: object
   *                      description: contains arrays user objects related
   *                      properties:
   *                        userGroupRelations:
   *                          type: array
   *                          items:
   *                            type: object
   *                        relationsOfChildGroups:
   *                          type: array
   *                          items:
   *                            type: object
   */
  router.get('/', accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]), loginRequiredStrictly, adminRequired, validator.list, async(req, res) => {
    const { query } = req;

    try {
      const relations = await UserGroupRelation.find({ relatedGroup: { $in: query.groupIds } }).populate('relatedUser');

      let relationsOfChildGroups = null;
      if (Array.isArray(query.childGroupIds)) {
        const _relationsOfChildGroups = await UserGroupRelation.find({ relatedGroup: { $in: query.childGroupIds } }).populate('relatedUser');
        relationsOfChildGroups = _relationsOfChildGroups.map(relation => serializeUserGroupRelationSecurely(relation)); // serialize
      }

      const serialized = relations.map(relation => serializeUserGroupRelationSecurely(relation));

      return res.apiv3({ userGroupRelations: serialized, relationsOfChildGroups });
    }
    catch (err) {
      const msg = 'Error occurred in fetching user group relations';
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(msg, 'user-group-relation-list-fetch-failed'));
    }
  });

  return router;
};
