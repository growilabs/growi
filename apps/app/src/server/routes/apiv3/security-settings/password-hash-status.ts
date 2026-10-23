import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import mongoose from 'mongoose';

import type { PasswordHashStatusResponse } from '~/interfaces/password-hash-status';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { countPasswordHashFormats } from '~/server/service/legacy-password-cleanup';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:security-setting:password-hash-status',
);

/**
 * @swagger
 *
 *    /security-setting/password-hash-status:
 *      get:
 *        tags: [SecuritySetting]
 *        security:
 *          - cookieAuth: []
 *        summary: /security-setting/password-hash-status
 *        description: Get the number of users per password-hash format
 *        responses:
 *          200:
 *            description: Number of users per password-hash format
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    counts:
 *                      type: object
 *                      properties:
 *                        upgradedOnly:
 *                          type: integer
 *                          description: Users with the new hash only
 *                        both:
 *                          type: integer
 *                          description: Users with both the new hash and the legacy password (deletion target)
 *                        legacyOnly:
 *                          type: object
 *                          description: Users with the legacy password only
 *                          properties:
 *                            active:
 *                              type: integer
 *                            nonActive:
 *                              type: integer
 *                        noPassword:
 *                          type: integer
 *                          description: Users without any password
 */
export const getPasswordHashStatusHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    async (_req: Request, res: ApiV3Response) => {
      try {
        const users = mongoose.connection.collection('users');
        const counts = await countPasswordHashFormats(users);
        const body: PasswordHashStatusResponse = { counts };
        return res.apiv3(body);
      } catch (err) {
        logger.error('Failed to count password-hash formats', err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to get password-hash status',
            'password-hash-status-fetch-failed',
          ),
          500,
        );
      }
    },
  ];
};
