import { SCOPE } from '@growi/core/dist/interfaces';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';

import type { ChangeProposalService } from '../services/change-proposal-service';

export type GetChangeProposalService = () => ChangeProposalService;

// Set by loginRequired (strict), which runs before every read handler.
export type AuthenticatedRequest<P, B, Q> = Request<P, unknown, B, Q> & {
  user?: Parameters<ChangeProposalService['getForViewer']>[1];
};

// Read routes: no excludeReadOnlyUser and no addActivity (design Routes table).
export const readAccessChain = (crowi: Crowi): RequestHandler[] => [
  accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
  loginRequiredFactory(crowi, false),
];
