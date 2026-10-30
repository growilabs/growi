import assert from 'node:assert';
import { type IUserHasId, SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ListSearchHistoriesResponseBody } from '../../../interfaces/search-history';
import { listSearchHistories } from '../../services/search-history';

const logger = loggerFactory('growi:features:search:search-history');

type Req = Request & { user?: IUserHasId };

/**
 * @swagger
 *
 *    /search-history:
 *      get:
 *        tags: [SearchHistory]
 *        summary: List the search history of the logged-in user, newest first
 *        description: Authentication requires a token with scope `read:features:page`.
 *        responses:
 *          200:
 *            description: The caller's search history (empty when there is none)
 */
export const listSearchHistoriesHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, false);

  return [
    // biome-ignore lint/suspicious/noTsIgnore: Scope type causes "Type instantiation is excessively deep" with tsgo
    // @ts-ignore
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequired middleware)',
      );

      try {
        const searchHistories = await listSearchHistories(user._id.toString());
        const body: ListSearchHistoriesResponseBody = { searchHistories };
        return res.apiv3(body);
      } catch (err) {
        logger.error({ err }, 'Error in GET /search-history');
        return res.apiv3Err(
          new ErrorV3(
            'Failed to list search histories',
            'failed-to-list-search-histories',
          ),
          500,
        );
      }
    },
  ];
};
