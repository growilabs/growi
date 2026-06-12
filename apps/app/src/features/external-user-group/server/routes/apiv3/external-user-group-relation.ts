import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';

import type { IExternalUserGroupRelationHasId } from '~/features/external-user-group/interfaces/external-user-group.js';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation.js';
import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import adminRequiredFactory from '~/server/middlewares/admin-required.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import { serializeUserGroupRelationSecurely } from '~/server/models/serializers/user-group-relation-serializer.js';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:routes:apiv3:user-group-relation');

const router = express.Router();

export const setup = (crowi: Crowi): Router => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  const validators = {
    list: [
      query('groupIds').isArray(),
      query('childGroupIds').optional().isArray(),
    ],
  };

  /**
   * @swagger
   * /external-user-group-relations:
   *   get:
   *     summary: /external-user-group-relations
   *     description: Get user group relations
   *     tags: [ExternalUserGroups]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: groupIds
   *         in: query
   *         description: The group IDs to get relations for
   *         schema:
   *           type: array
   *           items:
   *             type: string
   *       - name: childGroupIds
   *         in: query
   *         description: The child group IDs to get relations for
   *         required: false
   *         schema:
   *           type: array
   *           items:
   *             type: string
   *     responses:
   *       200:
   *         description: The user group relations
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 userGroupRelations:
   *                   type: array
   *                   items:
   *                     type: object
   *                 relationsOfChildGroups:
   *                   type: array
   *                   items:
   *                     type: object
   */
  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.USER_GROUP_MANAGEMENT]),
    loginRequiredStrictly,
    adminRequired,
    validators.list,
    async (req: Request, res: ApiV3Response) => {
      const { query } = req;

      try {
        const relations = await ExternalUserGroupRelation.find({
          relatedGroup: { $in: query.groupIds },
        }).populate('relatedUser');

        let relationsOfChildGroups: IExternalUserGroupRelationHasId[] | null =
          null;
        if (Array.isArray(query.childGroupIds)) {
          const _relationsOfChildGroups = await ExternalUserGroupRelation.find({
            relatedGroup: { $in: query.childGroupIds },
          }).populate('relatedUser');
          relationsOfChildGroups = _relationsOfChildGroups.map((relation) =>
            serializeUserGroupRelationSecurely(relation),
          ); // serialize
        }

        const serialized = relations.map((relation) =>
          serializeUserGroupRelationSecurely(relation),
        );

        return res.apiv3({
          userGroupRelations: serialized,
          relationsOfChildGroups,
        });
      } catch (err) {
        const msg = 'Error occurred in fetching user group relations';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg));
      }
    },
  );

  return router;
};
