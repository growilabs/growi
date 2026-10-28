import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import type { DeleteLegacyPasswordsResponse } from '~/interfaces/password-hash-status';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { unsetLegacyPasswordOfMigratedUsers } from '~/server/service/legacy-password-cleanup';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:security-setting:delete-legacy-passwords',
);

interface DeleteLegacyPasswordsRequest
  extends Request<Record<string, string>, ApiV3Response, undefined> {
  user: IUserHasId;
}

/**
 * @swagger
 *
 *    /security-setting/legacy-passwords:
 *      delete:
 *        tags: [SecuritySetting]
 *        security:
 *          - cookieAuth: []
 *        summary: /security-setting/legacy-passwords
 *        description: Delete the legacy password of users who already have the new password hash
 *        responses:
 *          200:
 *            description: Number of users whose legacy password was deleted
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    unsetCount:
 *                      type: integer
 *                      description: Number of users whose legacy password was deleted
 */
export const deleteLegacyPasswordsHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();
  const activityEvent = crowi.events.activity;

  return [
    accessTokenParser([SCOPE.WRITE.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    async (req: DeleteLegacyPasswordsRequest, res: ApiV3Response) => {
      const { user } = req;

      let unset: number;
      try {
        const users = mongoose.connection.collection('users');
        ({ unset } = await unsetLegacyPasswordOfMigratedUsers(users));

        logger.info(
          `Legacy passwords deleted by ${user.username} (${user._id}): unsetCount=${unset}`,
        );
      } catch (err) {
        logger.error('Failed to delete legacy passwords', err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to delete legacy passwords',
            'legacy-password-delete-failed',
          ),
          500,
        );
      }

      // The deletion is already committed, so a failure to hand over the
      // activity must not turn the response into an error.
      try {
        // emit before res.apiv3() — see rules/activity-recording.md
        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_ADMIN_LEGACY_PASSWORD_DELETE,
        });
      } catch (err) {
        logger.error('Failed to record the legacy password deletion', err);
      }

      const body: DeleteLegacyPasswordsResponse = { unsetCount: unset };
      return res.apiv3(body);
    },
  ];
};
