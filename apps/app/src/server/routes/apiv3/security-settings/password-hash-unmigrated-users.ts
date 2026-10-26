import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';
import mongoose from 'mongoose';

import type { PasswordHashUnmigratedUsersResponse } from '~/interfaces/password-hash-status';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { listUnmigratedUsersToNudge } from '~/server/service/password-hash-unmigrated-users';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:security-setting:password-hash-unmigrated-users',
);

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parseIntOrDefault = (value: unknown, defaultValue: number): number =>
  value == null ? defaultValue : Number.parseInt(String(value), 10);

/**
 * @swagger
 *
 *    /security-setting/password-hash-unmigrated-users:
 *      get:
 *        tags: [SecuritySetting]
 *        security:
 *          - cookieAuth: []
 *        summary: /security-setting/password-hash-unmigrated-users
 *        description: Get the users who still have only the legacy password and no linked external account
 *        parameters:
 *          - name: page
 *            in: query
 *            required: false
 *            schema:
 *              type: integer
 *              minimum: 1
 *              default: 1
 *          - name: limit
 *            in: query
 *            required: false
 *            schema:
 *              type: integer
 *              minimum: 1
 *              maximum: 100
 *              default: 20
 *        responses:
 *          200:
 *            description: A page of users who need to be nudged to log in
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    users:
 *                      type: array
 *                      items:
 *                        type: object
 *                        properties:
 *                          _id:
 *                            type: string
 *                          username:
 *                            type: string
 *                          email:
 *                            type: string
 *                            nullable: true
 *                          lastLoginAt:
 *                            type: string
 *                            format: date-time
 *                            nullable: true
 *                            description: null when the user has never logged in
 *                    totalCount:
 *                      type: integer
 *                    page:
 *                      type: integer
 *                    limit:
 *                      type: integer
 */
export const getPasswordHashUnmigratedUsersHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.ADMIN.SECURITY]),
    loginRequiredStrictly,
    adminRequired,
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: MAX_LIMIT }),
    apiV3FormValidator,
    async (req: Request, res: ApiV3Response) => {
      const page = parseIntOrDefault(req.query.page, DEFAULT_PAGE);
      const limit = parseIntOrDefault(req.query.limit, DEFAULT_LIMIT);
      try {
        const users = mongoose.connection.collection('users');
        const externalAccounts =
          mongoose.connection.collection('externalaccounts');
        const body: PasswordHashUnmigratedUsersResponse =
          await listUnmigratedUsersToNudge(users, externalAccounts, {
            page,
            limit,
          });
        return res.apiv3(body);
      } catch (err) {
        logger.error('Failed to list password-hash unmigrated users', err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to get password-hash unmigrated users',
            'password-hash-unmigrated-users-fetch-failed',
          ),
          500,
        );
      }
    },
  ];
};
