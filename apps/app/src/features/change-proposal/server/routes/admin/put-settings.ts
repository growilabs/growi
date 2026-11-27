import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ChangeProposalSettingsUpdate } from '../../../interfaces';
import type { ChangeProposalService } from '../../services/change-proposal-service';
import {
  AUTO_APPLY_POLICIES,
  CREATABLE_OPERATION_TYPES,
  readChangeProposalSettings,
  updateChangeProposalSettings,
} from '../../services/settings';
import {
  isFixedByEnvVars,
  readChangeProposalSettingsView,
} from './settings-view';

const logger = loggerFactory(
  'growi:features:change-proposal:routes:admin:put-settings',
);

const UPDATABLE_KEYS: ReadonlySet<string> = new Set<
  keyof ChangeProposalSettingsUpdate
>([
  'isEnabled',
  'enabledOperationTypes',
  'autoApplyPolicy',
  'maxOperationsPerProposal',
  'maxProposalsPerUserPerDay',
  'perPageNotificationsEnabled',
]);

const isBoolean = (value: unknown): boolean => typeof value === 'boolean';

// null clears the limit; anything else must be a whole number of at least 1.
const isLimit = (value: unknown): boolean =>
  value === null ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1);

const isOperationTypeList = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every((type) => CREATABLE_OPERATION_TYPES.includes(type)) &&
  new Set(value).size === value.length;

// Each check is a typeof/identity test, so "true", 1 and "5" are refused rather than coerced.
const validator: ValidationChain[] = [
  body()
    .custom(
      (value) =>
        value != null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).every((key) => UPDATABLE_KEYS.has(key)),
    )
    .withMessage('The body may hold only the editable settings'),
  body('isEnabled')
    .optional()
    .custom(isBoolean)
    .withMessage('isEnabled must be a boolean'),
  body('enabledOperationTypes')
    .optional()
    .custom(isOperationTypeList)
    .withMessage(
      `enabledOperationTypes must list distinct values of ${CREATABLE_OPERATION_TYPES.join(', ')}`,
    ),
  body('autoApplyPolicy')
    .optional()
    .custom((value) => AUTO_APPLY_POLICIES.includes(value))
    .withMessage(
      `autoApplyPolicy must be one of ${AUTO_APPLY_POLICIES.join(', ')}`,
    ),
  body('maxOperationsPerProposal')
    .optional()
    .custom(isLimit)
    .withMessage(
      'maxOperationsPerProposal must be an integer of 1 or more, or null',
    ),
  body('maxProposalsPerUserPerDay')
    .optional()
    .custom(isLimit)
    .withMessage(
      'maxProposalsPerUserPerDay must be an integer of 1 or more, or null',
    ),
  body('perPageNotificationsEnabled')
    .optional()
    .custom(isBoolean)
    .withMessage('perPageNotificationsEnabled must be a boolean'),
];

/**
 * @swagger
 *
 *    /change-proposal-settings:
 *      put:
 *        tags: [ChangeProposalSettings]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: Update the change proposal settings
 *        description: >
 *          Admin only. Requires the `write:admin:app` scope. Omitted fields stay unchanged;
 *          unknown fields are refused. Turning `isEnabled` off withdraws every pending
 *          change proposal before the response. Refused with 400 while the settings are
 *          fixed by environment variables (`useOnlyEnvVars`).
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                additionalProperties: false
 *                properties:
 *                  isEnabled:
 *                    type: boolean
 *                  enabledOperationTypes:
 *                    type: array
 *                    description: The full list of enabled types; an empty list turns every type off
 *                    uniqueItems: true
 *                    items:
 *                      type: string
 *                      enum: [edit, create, move]
 *                  autoApplyPolicy:
 *                    type: string
 *                    enum: [none, own-pages, all]
 *                  maxOperationsPerProposal:
 *                    type: integer
 *                    minimum: 1
 *                    nullable: true
 *                    description: null stops checking the number of operations
 *                  maxProposalsPerUserPerDay:
 *                    type: integer
 *                    minimum: 1
 *                    nullable: true
 *                    description: null removes the daily limit
 *                  perPageNotificationsEnabled:
 *                    type: boolean
 *        responses:
 *          200:
 *            description: The settings after the update
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    settings:
 *                      $ref: '#/components/schemas/ChangeProposalSettings'
 *          400:
 *            description: Invalid request body, or the settings are fixed by environment variables (code settings_fixed_by_env_vars)
 *          302:
 *            description: The caller is logged in but not an admin (redirected to /)
 *          403:
 *            description: Not authenticated or insufficient scope
 */
export const putSettingsRouteHandlersFactory = (
  crowi: Crowi,
  getService: () => ChangeProposalService,
): RequestHandler[] => {
  const activityEvent = crowi.events.activity;

  return [
    accessTokenParser([SCOPE.WRITE.ADMIN.APP], { acceptLegacy: true }),
    loginRequiredFactory(crowi),
    adminRequiredFactory(crowi),
    generateAddActivityMiddleware(),
    ...validator,
    apiV3FormValidator,
    async (
      req: Request<unknown, unknown, ChangeProposalSettingsUpdate>,
      res: ApiV3Response,
    ) => {
      if (isFixedByEnvVars()) {
        return res.apiv3Err(
          new ErrorV3(
            'The change proposal settings are fixed by environment variables',
            'settings_fixed_by_env_vars',
          ),
          400,
        );
      }

      try {
        const wasEnabled = readChangeProposalSettings().isEnabled;
        await updateChangeProposalSettings(req.body);
        if (wasEnabled && !readChangeProposalSettings().isEnabled) {
          await withdrawPendingProposals(getService());
        }
      } catch (err) {
        logger.error({ err }, 'Failed to update the change proposal settings');
        return res.apiv3Err(
          new ErrorV3(
            'Failed to update the change proposal settings',
            'update_settings_failed',
          ),
          500,
        );
      }

      // emit before res.apiv3() — see rules/activity-recording.md
      const activityId: unknown = res.locals.activity?._id;
      // addActivity is best-effort; without its id there is no row to settle.
      if (typeof activityId === 'string') {
        activityEvent.emit('update', activityId, {
          action: SupportedAction.ACTION_ADMIN_CHANGE_PROPOSAL_SETTINGS_UPDATE,
        });
      }
      return res.apiv3({ settings: readChangeProposalSettingsView() });
    },
  ];
};

// The settings are already saved, so a failed withdrawal does not fail the request.
// The maintenance cron withdraws pending proposals while the feature is off, as long
// as changeProposal:maintenanceCronSchedule is set.
const withdrawPendingProposals = async (
  service: ChangeProposalService,
): Promise<void> => {
  try {
    await service.withdrawAllPending();
  } catch (err) {
    logger.error(
      { err },
      'Failed to withdraw pending change proposals; the maintenance cron will retry',
    );
  }
};
