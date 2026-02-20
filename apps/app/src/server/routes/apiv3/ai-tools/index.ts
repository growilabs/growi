import express from 'express';

import type Crowi from '~/server/crowi';

import { suggestPathHandlersFactory } from './suggest-path';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  router.post('/suggest-path', suggestPathHandlersFactory(crowi));
  return router;
};
