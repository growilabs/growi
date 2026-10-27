import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { query } from 'express-validator';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { isAppliedListCursor } from '../services/proposal-list-query';
import { limitValidator, toLimit } from './list-query-params';
import {
  type AuthenticatedRequest,
  type GetChangeProposalService,
  readAccessChain,
} from './read-access';

const logger = loggerFactory(
  'growi:features:change-proposal:routes:list-applied',
);

type Req = AuthenticatedRequest<
  Record<string, string>,
  unknown,
  { cursor?: string; limit?: string }
>;

const validator = [
  query('cursor')
    .optional()
    .isString()
    .bail()
    .custom((value: string) => isAppliedListCursor(value))
    .withMessage('cursor is malformed'),
  limitValidator(),
];

export const listAppliedRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...readAccessChain(crowi),
  ...validator,
  apiV3FormValidator,
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      const { items, nextCursor } = await getService().listAppliedVisible(
        user,
        req.query.cursor ?? null,
        toLimit(req.query.limit),
      );
      return res.apiv3({ items, nextCursor });
    } catch (err) {
      logger.error({ err }, 'Failed to list applied change proposals');
      return res.apiv3Err(
        new ErrorV3('Failed to list change proposals', 'list-failed'),
        500,
      );
    }
  },
];
