import express from 'express';

import type Crowi from '~/server/crowi';

import { createPageHandlersFactory } from './create-page';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  // TODO: https://redmine.weseek.co.jp/issues/173815
  router.post('/page', createPageHandlersFactory(crowi));
  return router;
};
