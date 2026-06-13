import express from 'express';

import type Crowi from '~/server/crowi/index.js';

import { getRelatedGroupsHandlerFactory } from './get-related-groups.js';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  router.get('/related-groups', getRelatedGroupsHandlerFactory(crowi));

  return router;
};
