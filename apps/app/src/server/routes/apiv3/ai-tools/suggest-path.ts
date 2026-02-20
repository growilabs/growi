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

import { extractKeywords } from './extract-keywords';
import { generateSuggestions } from './generate-suggestions';

const logger = loggerFactory('growi:routes:apiv3:ai-tools:suggest-path');

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

const validator = [
  body('body')
    .isString()
    .withMessage('body must be a string')
    .notEmpty()
    .withMessage('body must not be empty'),
];

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
          { searchService, extractKeywords },
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
