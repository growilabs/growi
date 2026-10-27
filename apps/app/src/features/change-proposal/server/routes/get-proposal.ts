import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ChangeProposalView } from '../../interfaces';
import {
  type AuthenticatedRequest,
  type GetChangeProposalService,
  readAccessChain,
} from './read-access';

const logger = loggerFactory(
  'growi:features:change-proposal:routes:get-proposal',
);

type Req = AuthenticatedRequest<Record<string, string>, unknown, unknown>;

// Missing, malformed and invisible all share this body (rules/page-write-action-403-404.md).
export const proposalNotFound = (): ErrorV3 =>
  new ErrorV3('Change proposal is not found', 'notfound');

export const getProposalRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...readAccessChain(crowi),
  // No id validator: a malformed id must look exactly like a missing one.
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      const result = await getService().getForViewer(req.params.id, user);
      if (!result.ok) {
        return res.apiv3Err(proposalNotFound(), 404);
      }
      const proposal: ChangeProposalView = result.value;
      return res.apiv3({ proposal });
    } catch (err) {
      logger.error({ err }, 'Failed to get a change proposal');
      return res.apiv3Err(
        new ErrorV3('Failed to get the change proposal', 'get-failed'),
        500,
      );
    }
  },
];
