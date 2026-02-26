import express from 'express';

import { suggestPathHandlersFactory } from '~/features/suggest-path/server/routes/apiv3';
import type Crowi from '~/server/crowi';

export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();
  router.post('/suggest-path', suggestPathHandlersFactory(crowi));
  return router;
};
