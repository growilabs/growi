import express from 'express';

import { suggestPathHandlersFactory } from '~/features/ai-tools/suggest-path/server/routes/apiv3/index.js';
import type Crowi from '~/server/crowi/index.js';

export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();
  router.post('/suggest-path', suggestPathHandlersFactory(crowi));
  return router;
};
