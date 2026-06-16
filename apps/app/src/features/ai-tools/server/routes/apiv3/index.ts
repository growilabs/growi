import express from 'express';

import type Crowi from '~/server/crowi';

import { suggestPathHandlersFactory } from '../../../suggest-path/server/routes/apiv3';

export const factory = (crowi: Crowi): express.Router => {
  const router = express.Router();
  router.post('/suggest-path', suggestPathHandlersFactory(crowi));
  return router;
};
