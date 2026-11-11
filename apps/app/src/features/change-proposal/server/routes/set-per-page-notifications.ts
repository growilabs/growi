import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body } from 'express-validator';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type {
  AuthenticatedRequest,
  GetChangeProposalService,
} from './read-access';
import { respondWithServiceError, writeAccessChain } from './write-access';

const logger = loggerFactory(
  'growi:features:change-proposal:routes:set-per-page-notifications',
);

type Req = AuthenticatedRequest<
  Record<string, string>,
  { enabled: boolean },
  unknown
>;

const validator = [
  // isBoolean() would also take "true" and 1, which the service answers as not-found.
  body('enabled')
    .custom((value) => typeof value === 'boolean')
    .withMessage('enabled must be a boolean'),
];

/**
 * @swagger
 *
 *    /change-proposals/{id}/per-page-notifications:
 *      put:
 *        tags: [ChangeProposals]
 *        summary: Change whether applying the caller's change proposal sends per-page notifications
 *        description: >
 *          Applies to operations applied after the change only. Per-page notifications
 *          are sent only while the admin setting is also on. Only the requester may change
 *          it; anyone else gets the same 404 as a missing id. Requires the
 *          `write:features:page` scope.
 *        parameters:
 *          - name: id
 *            in: path
 *            required: true
 *            schema:
 *              type: string
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                required:
 *                  - enabled
 *                properties:
 *                  enabled:
 *                    type: boolean
 *        responses:
 *          200:
 *            description: Changed
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *          400:
 *            description: Invalid request body, or a read-only user
 *          403:
 *            description: Not authenticated or insufficient scope
 *          404:
 *            description: The proposal does not exist or the caller is not its requester (code notfound)
 *          409:
 *            description: The proposal is no longer open (code not_open)
 */
export const setPerPageNotificationsRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...writeAccessChain(crowi),
  ...validator,
  apiV3FormValidator,
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      const result = await getService().setPerPageNotifications(
        req.params.id,
        user,
        req.body.enabled,
      );
      if (!result.ok) {
        return respondWithServiceError(res, result.error);
      }
      return res.apiv3({});
    } catch (err) {
      logger.error(
        { err },
        'Failed to change the per-page notification switch',
      );
      return res.apiv3Err(
        new ErrorV3(
          'Failed to change the per-page notification switch',
          'per-page-notifications-failed',
        ),
        500,
      );
    }
  },
];
