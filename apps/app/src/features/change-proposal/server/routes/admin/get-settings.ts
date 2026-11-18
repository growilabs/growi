import { SCOPE } from '@growi/core/dist/interfaces';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { readChangeProposalSettingsView } from './settings-view';

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     ChangeProposalSettings:
 *       type: object
 *       required:
 *         - isEnabled
 *         - enabledOperationTypes
 *         - autoApplyPolicy
 *         - maxOperationsPerProposal
 *         - maxProposalsPerUserPerDay
 *         - perPageNotificationsEnabled
 *         - useOnlyEnvVars
 *       properties:
 *         isEnabled:
 *           type: boolean
 *           description: Whether change proposals can be created and applied
 *         enabledOperationTypes:
 *           type: array
 *           description: The operation types a change proposal may carry
 *           items:
 *             type: string
 *             enum: [edit, create, move]
 *         autoApplyPolicy:
 *           type: string
 *           enum: [none, own-pages, all]
 *         maxOperationsPerProposal:
 *           type: integer
 *           minimum: 1
 *           nullable: true
 *           description: null means the number of operations is not checked
 *         maxProposalsPerUserPerDay:
 *           type: integer
 *           minimum: 1
 *           nullable: true
 *           description: null means no daily limit
 *         perPageNotificationsEnabled:
 *           type: boolean
 *           description: Whether applying sends the same per-page notifications as a human edit (only when the proposal also asks for them)
 *         useOnlyEnvVars:
 *           type: boolean
 *           description: >
 *             True when CHANGE_PROPOSAL_USES_ONLY_ENV_VARS fixes every value above to its
 *             environment variable; the values are then read-only.
 */

/**
 * @swagger
 *
 *    /change-proposal-settings:
 *      get:
 *        tags: [ChangeProposalSettings]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: Get the change proposal settings
 *        description: Admin only. Requires the `read:admin:app` scope.
 *        responses:
 *          200:
 *            description: The effective settings
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    settings:
 *                      $ref: '#/components/schemas/ChangeProposalSettings'
 *          302:
 *            description: The caller is logged in but not an admin (redirected to /)
 *          403:
 *            description: Not authenticated or insufficient scope
 */
export const getSettingsRouteHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => [
  accessTokenParser([SCOPE.READ.ADMIN.APP], { acceptLegacy: true }),
  loginRequiredFactory(crowi),
  adminRequiredFactory(crowi),
  (_req: Request, res: ApiV3Response) =>
    res.apiv3({ settings: readChangeProposalSettingsView() }),
];
