import assert from 'node:assert';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body } from 'express-validator';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import { certifyAiService } from '~/features/openai/server/routes/middlewares/certify-ai-service';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import UserGroupRelation from '~/server/models/user-group-relation';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { SearchService } from '../../../interfaces/suggest-path-types';
import { generateSuggestions } from '../../services/generate-suggestions';

const logger = loggerFactory('growi:features:suggest-path:routes');

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     PathSuggestion:
 *       type: object
 *       required:
 *         - type
 *         - path
 *         - label
 *         - description
 *         - grant
 *       properties:
 *         type:
 *           type: string
 *           enum: [memo, search, category]
 *           description: The type of suggestion
 *         path:
 *           type: string
 *           description: Suggested page path
 *           example: "/user/alice/2026/04/01/meeting-notes"
 *         label:
 *           type: string
 *           description: Human-readable label for the suggestion
 *         description:
 *           type: string
 *           description: Explanation of why this path is suggested
 *         grant:
 *           type: integer
 *           description: Page grant (1=public, 4=owner_only, 5=user_group)
 *         informationType:
 *           type: string
 *           enum: [flow, stock]
 *           description: Whether the content is flow (time-based) or stock (reference)
 *     SuggestPathResponse:
 *       type: object
 *       properties:
 *         suggestions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PathSuggestion'
 */

type ReqBody = {
  body: string;
};

type SuggestPathReq = Request<
  Record<string, string>,
  ApiV3Response,
  ReqBody
> & {
  user?: IUserHasId;
};

const MAX_BODY_LENGTH = 100_000;

const validator = [
  body('body')
    .isString()
    .withMessage('body must be a string')
    .notEmpty()
    .withMessage('body must not be empty')
    .isLength({ max: MAX_BODY_LENGTH })
    .withMessage(`body must not exceed ${MAX_BODY_LENGTH} characters`),
];

/**
 * @swagger
 *
 * /ai-tools/suggest-path:
 *   post:
 *     summary: Suggest page paths based on content
 *     description: Analyzes the given content and suggests appropriate page paths using keyword extraction, search, and AI evaluation.
 *     tags: [AI Tools]
 *     security:
 *       - bearer: []
 *       - accessTokenInQuery: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - body
 *             properties:
 *               body:
 *                 type: string
 *                 description: The page content to analyze for path suggestions
 *                 maxLength: 50000
 *     responses:
 *       200:
 *         description: Path suggestions generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuggestPathResponse'
 *       500:
 *         description: Failed to generate path suggestions
 */
export const suggestPathHandlersFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    certifyAiService,
    ...validator,
    apiV3FormValidator,
    async (req: SuggestPathReq, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequiredStrictly middleware)',
      );

      try {
        const { searchService } = crowi;
        assert(
          searchService != null &&
            typeof (searchService as unknown as Record<string, unknown>)
              .searchKeyword === 'function',
          'searchService must have searchKeyword method',
        );
        const typedSearchService = searchService as unknown as SearchService;

        const userGroups = [
          ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
          ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(
            user,
          )),
        ];

        const suggestions = await generateSuggestions(
          user,
          req.body.body,
          userGroups,
          typedSearchService,
        );
        return res.apiv3({ suggestions });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Failed to generate path suggestions'),
          500,
        );
      }
    },
  ];
};
