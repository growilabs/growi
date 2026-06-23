import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { isModelInAllowList } from '~/features/mastra/interfaces/allowed-model';
import type { ChatModelsResponse } from '~/features/mastra/interfaces/chat-models-response';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import UserUISettings from '~/server/models/user-ui-settings';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import {
  getAllowedModels,
  getDefaultModel,
} from '../services/ai-sdk-modules/llm-providers/config';

const logger = loggerFactory('growi:routes:apiv3:mastra:get-models');

type GetModelsFactory = (crowi: Crowi) => RequestHandler[];

interface Req extends Request {
  user: IUserHasId;
}

export const getModelsFactory: GetModelsFactory = (crowi) => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.FEATURES.AI], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: Req, res: ApiV3Response) => {
      try {
        const allowedModels = getAllowedModels();
        // Only the model ids are exposed (no display name: ids have none, and
        // providerOptions are server-only and MUST NOT be sent — Security).
        const models = allowedModels.map((m) => m.model);

        const defaultModelId = getDefaultModel();
        if (defaultModelId == null) {
          // aiReadyGuard guarantees a non-empty allow-list (hence a default); this
          // only covers the rare case where it was emptied between the guard and
          // here. Returning an error keeps selectedModelId non-optional below.
          return res.apiv3Err(new ErrorV3('No models are configured'), 500);
        }

        // The user's persisted selection. Never trusted as-is: an out-of-allowlist
        // (e.g. since-removed) or absent value rounds to the default. Centralising
        // this server-side keeps Req 3.7 consistent regardless of the client.
        const userUISettings = await UserUISettings.findOne({
          user: req.user._id,
        }).lean();
        const savedModelId = userUISettings?.aiChatSelectedModel;
        const selectedModelId =
          savedModelId != null &&
          isModelInAllowList(savedModelId, allowedModels)
            ? savedModelId
            : defaultModelId;

        const response: ChatModelsResponse = { models, selectedModelId };
        return res.apiv3(response);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get models'));
      }
    },
  ];
};
