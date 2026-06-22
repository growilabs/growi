import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

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

// The chat model list returned to the client. Only model IDs are exposed —
// providerOptions are server-only and MUST NOT be sent (Security).
interface ModelOption {
  id: string;
  name: string;
}

interface GetModelsResponse {
  models: ModelOption[];
  defaultModelId?: string;
  selectedModelId?: string;
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
        // No friendly names exist for free-form model IDs, so name = id.
        const models: ModelOption[] = allowedModels.map((m) => ({
          id: m.model,
          name: m.model,
        }));
        const defaultModelId = getDefaultModel();

        // The user's persisted selection. Never trusted as-is: an out-of-allowlist
        // (e.g. since-removed) or absent value rounds to the default. Centralising
        // this server-side keeps Req 3.7 consistent regardless of the client.
        const userUISettings = await UserUISettings.findOne({
          user: req.user._id,
        }).lean();
        const savedModelId = userUISettings?.aiChatSelectedModel;
        const isSavedAllowed =
          savedModelId != null &&
          allowedModels.some((m) => m.model === savedModelId);
        const selectedModelId = isSavedAllowed ? savedModelId : defaultModelId;

        // providerOptions deliberately omitted from the response (server-only).
        const response: GetModelsResponse = {
          models,
          defaultModelId,
          selectedModelId,
        };
        return res.apiv3(response);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get models'));
      }
    },
  ];
};
