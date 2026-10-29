import express, { type Router } from 'express';

import type Crowi from '~/server/crowi';

import { listSearchHistoriesHandlersFactory } from './list-search-histories';
import { recordSearchHistoryHandlersFactory } from './record-search-history';

export const createSearchHistoryRouter = (crowi: Crowi): Router => {
  const router = express.Router();
  router.get('/', listSearchHistoriesHandlersFactory(crowi));
  router.post('/', recordSearchHistoryHandlersFactory(crowi));
  return router;
};
