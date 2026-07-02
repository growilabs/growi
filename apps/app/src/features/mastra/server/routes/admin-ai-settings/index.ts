import express from 'express';

import type Crowi from '~/server/crowi';

import { getAiSettingsFactory } from './get-ai-settings';
import { getAvailableModelsFactory } from './get-available-models';
import { postRefreshModelCatalogFactory } from './post-refresh-model-catalog';
import { putAiSettingsFactory } from './put-ai-settings';

/**
 * Router factory for the admin AI settings endpoints, mounted under
 * `routerForAdmin` at `/ai-settings` (so the full path is `/_api/v3/ai-settings`).
 *
 * Each route's middleware chain (scope + login + admin authorization, plus the
 * validator/activity chain for PUT) lives in its handler factory; this router
 * just mounts the returned `RequestHandler[]`. Deliberately NO `isAiEnabled` /
 * ai-ready guard is attached: administrators must be able to configure AI even
 * while the feature is disabled or not yet configured (Req 1).
 *
 *   - GET  /                       : returns the effective AI settings for the admin UI.
 *   - PUT  /                       : updates the AI settings (adds activity, validates the body).
 *   - GET  /available-models       : returns the selectable model ids for a provider (local catalog).
 *   - POST /refresh-model-catalog  : refreshes the selectable-model catalog from models.dev (Req 9.1).
 */
export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();

  router.get('/', getAiSettingsFactory(crowi));
  router.put('/', putAiSettingsFactory(crowi));
  router.get('/available-models', getAvailableModelsFactory(crowi));
  router.post('/refresh-model-catalog', postRefreshModelCatalogFactory(crowi));

  return router;
};
