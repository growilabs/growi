import express from 'express';

import { getContributionsHandlerFactory } from '~/features/contribution-graph/server/routes/get-contributions';
import type Crowi from '~/server/crowi';

import { getRelatedGroupsHandlerFactory } from './get-related-groups';
import { getRelatedGroupsMembersHandlerFactory } from './get-related-groups-members';

const router = express.Router();

export const factory = (crowi: Crowi): express.Router => {
  router.get('/related-groups', getRelatedGroupsHandlerFactory(crowi));
  router.get(
    '/related-groups/members',
    getRelatedGroupsMembersHandlerFactory(crowi),
  );
  router.get('/contributions', getContributionsHandlerFactory(crowi));

  return router;
};
