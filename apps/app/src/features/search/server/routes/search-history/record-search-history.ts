import assert from 'node:assert';
import { type IUserHasId, SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type {
  RecordSearchHistoryRequestBody,
  RecordSearchHistoryResponseBody,
} from '../../../interfaces/search-history';
import { toSearchHistoryKeyword } from '../../../utils/search-history-keyword';
import {
  InvalidSearchHistoryKeywordError,
  recordSearchHistory,
} from '../../services/search-history';

const logger = loggerFactory('growi:features:search:search-history');

type Req = Request<
  Record<string, string>,
  ApiV3Response,
  RecordSearchHistoryRequestBody
> & { user?: IUserHasId };

const validator = [
  body('keyword')
    .isString()
    .custom((value: string) => toSearchHistoryKeyword(value) != null)
    .withMessage('keyword must be a non-empty string within the length limit'),
];

/**
 * @swagger
 *
 *    /search-history:
 *      post:
 *        tags: [SearchHistory]
 *        summary: Record a search keyword in the search history of the logged-in user
 *        description: Authentication requires a token with scope `write:features:page`.
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                required:
 *                  - keyword
 *                properties:
 *                  keyword:
 *                    type: string
 *        responses:
 *          200:
 *            description: The recorded history item
 *          400:
 *            description: The keyword is empty or too long
 */
export const recordSearchHistoryHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, false);

  return [
    // biome-ignore lint/suspicious/noTsIgnore: Scope type causes "Type instantiation is excessively deep" with tsgo
    // @ts-ignore
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    ...validator,
    apiV3FormValidator,
    // No addActivity: the search API already records ACTION_SEARCH_PAGE (see search-history design.md).
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequired middleware)',
      );

      try {
        const searchHistory = await recordSearchHistory(
          user._id.toString(),
          req.body.keyword,
        );
        const responseBody: RecordSearchHistoryResponseBody = { searchHistory };
        return res.apiv3(responseBody);
      } catch (err) {
        if (err instanceof InvalidSearchHistoryKeywordError) {
          return res.apiv3Err(
            new ErrorV3(err.message, 'invalid-search-history-keyword'),
            400,
          );
        }
        logger.error({ err }, 'Error in POST /search-history');
        return res.apiv3Err(
          new ErrorV3(
            'Failed to record search history',
            'failed-to-record-search-history',
          ),
          500,
        );
      }
    },
  ];
};
