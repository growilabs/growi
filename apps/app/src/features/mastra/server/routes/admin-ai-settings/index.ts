import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';

import { getAiSettings } from './get-ai-settings';
import { putAiSettingsFactory } from './put-ai-settings';
import { updateAiSettingsValidators } from './validators';

/**
 * Router factory for the admin AI settings endpoints, mounted under
 * `routerForAdmin` at `/ai-settings` (so the full path is `/_api/v3/ai-settings`).
 *
 * Both endpoints are gated by the AI admin scope + login + admin authorization,
 * mirroring the app-settings router. Deliberately NO `isAiEnabled` / ai-ready
 * guard is attached: administrators must be able to configure AI even while the
 * feature is disabled or not yet configured (Req 1).
 *
 *   - GET  / : returns the effective AI settings for the admin UI.
 *   - PUT  / : updates the AI settings (adds activity, validates the body).
 */
export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();

  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();

  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.AI], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    getAiSettings,
  );

  router.put(
    '/',
    accessTokenParser([SCOPE.WRITE.ADMIN.AI]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    ...updateAiSettingsValidators,
    apiV3FormValidator,
    putAiSettingsFactory(crowi),
  );

  return router;
};
