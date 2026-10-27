import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body } from 'express-validator';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import {
  type AuthenticatedRequest,
  type GetChangeProposalService,
  readAccessChain,
} from './read-access';

const logger = loggerFactory(
  'growi:features:change-proposal:routes:revision-marks',
);

const MAX_REVISION_IDS = 100;

type Req = AuthenticatedRequest<
  Record<string, string>,
  { revisionIds: string[] },
  unknown
>;

const validator = [
  body('revisionIds')
    .isArray({ max: MAX_REVISION_IDS })
    .withMessage(`revisionIds must be an array of at most ${MAX_REVISION_IDS}`),
  body('revisionIds.*')
    .isString()
    .bail()
    .isMongoId()
    .withMessage('revisionIds must hold revision ids'),
];

// A read despite POST (the id list can be long): no addActivity, read scope.
export const revisionMarksRouteHandlersFactory = (
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
      const marks = await getService().getRevisionMarks(
        user,
        req.body.revisionIds,
      );
      return res.apiv3({ marks });
    } catch (err) {
      logger.error({ err }, 'Failed to get revision marks');
      return res.apiv3Err(
        new ErrorV3('Failed to get revision marks', 'revision-marks-failed'),
        500,
      );
    }
  },
];
