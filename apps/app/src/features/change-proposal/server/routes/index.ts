import express, { type Router } from 'express';

import type Crowi from '~/server/crowi';

import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../services/change-proposal-service';
import { approveRouteHandlersFactory } from './approve';
import { discardRouteHandlersFactory } from './discard';
import { getProposalRouteHandlersFactory } from './get-proposal';
import { listAppliedRouteHandlersFactory } from './list-applied';
import { listMineRouteHandlersFactory } from './list-mine';
import { revertRouteHandlersFactory } from './revert';
import { revertRequestRouteHandlersFactory } from './revert-request';
import { revisionMarksRouteHandlersFactory } from './revision-marks';
import { setPerPageNotificationsRouteHandlersFactory } from './set-per-page-notifications';
import { skipRouteHandlersFactory } from './skip';

export type ChangeProposalRouterDeps = {
  // Tests inject a service built with their own applier.
  readonly service?: ChangeProposalService;
};

/**
 * Router mounted at /_api/v3/change-proposals. Every route shares one service
 * instance, built on the first request so a server that never serves these
 * routes does not build it.
 */
export const createChangeProposalRouter = (
  crowi: Crowi,
  deps: ChangeProposalRouterDeps = {},
): Router => {
  let service = deps.service;
  const getService = (): ChangeProposalService => {
    service ??= createChangeProposalService(crowi);
    return service;
  };

  const router = express.Router();
  // Fixed paths before /:id, which would otherwise take them as ids.
  router.get('/mine', listMineRouteHandlersFactory(crowi, getService));
  router.get('/applied', listAppliedRouteHandlersFactory(crowi, getService));
  router.post(
    '/revision-marks',
    revisionMarksRouteHandlersFactory(crowi, getService),
  );
  router.post('/:id/approve', approveRouteHandlersFactory(crowi, getService));
  router.post('/:id/skip', skipRouteHandlersFactory(crowi, getService));
  router.post('/:id/discard', discardRouteHandlersFactory(crowi, getService));
  router.post('/:id/revert', revertRouteHandlersFactory(crowi, getService));
  router.post(
    '/:id/revert-request',
    revertRequestRouteHandlersFactory(crowi, getService),
  );
  router.put(
    '/:id/per-page-notifications',
    setPerPageNotificationsRouteHandlersFactory(crowi, getService),
  );
  router.get('/:id', getProposalRouteHandlersFactory(crowi, getService));
  return router;
};
