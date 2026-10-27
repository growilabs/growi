import express, { type Router } from 'express';

import type Crowi from '~/server/crowi';

import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../services/change-proposal-service';
import { getProposalRouteHandlersFactory } from './get-proposal';
import { listAppliedRouteHandlersFactory } from './list-applied';
import { listMineRouteHandlersFactory } from './list-mine';
import { revisionMarksRouteHandlersFactory } from './revision-marks';

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
  router.get('/:id', getProposalRouteHandlersFactory(crowi, getService));
  return router;
};
