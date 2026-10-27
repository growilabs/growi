import express, { type Router } from 'express';

import type Crowi from '~/server/crowi';

import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../../services/change-proposal-service';
import { getSettingsRouteHandlersFactory } from './get-settings';
import { putSettingsRouteHandlersFactory } from './put-settings';

export type ChangeProposalAdminRouterDeps = {
  readonly service?: ChangeProposalService;
};

/**
 * Router mounted on routerForAdmin at /change-proposal-settings
 * (/_api/v3/change-proposal-settings).
 */
export const createChangeProposalAdminRouter = (
  crowi: Crowi,
  deps: ChangeProposalAdminRouterDeps = {},
): Router => {
  let service = deps.service;
  // Only turning the feature off needs the service (to withdraw pending proposals).
  const getService = (): ChangeProposalService => {
    service ??= createChangeProposalService(crowi);
    return service;
  };

  const router = express.Router();
  router.get('/', getSettingsRouteHandlersFactory(crowi));
  router.put('/', putSettingsRouteHandlersFactory(crowi, getService));
  return router;
};
