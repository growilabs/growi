import express from 'express';

import type Crowi from '~/server/crowi';

import { createPageHandlersFactory } from './create-page';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  router.post('/page', createPageHandlersFactory(crowi));
  return router;
};
