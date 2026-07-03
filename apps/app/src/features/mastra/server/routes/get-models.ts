import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { isModelInAllowList } from '~/features/mastra/interfaces/allowed-model';
import type {
  ChatModelEntry,
  ChatModelsResponse,
} from '~/features/mastra/interfaces/chat-models-response';
import {
  buildModelKey,
  parseModelKey,
} from '~/features/mastra/interfaces/model-key';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import UserUISettings from '~/server/models/user-ui-settings';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { getEffectiveDefaultModelKey } from '../services/ai-sdk-modules/llm-providers/effective-model-key';
import { getAvailableModels } from '../services/ai-sdk-modules/llm-providers/provider-availability';

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
        // Only the available set (enabled ∧ configured providers' allowed
        // models — Req 4.1 / 6.1) is selectable; getAllowedModels would also
        // include disabled/misconfigured providers' models, so it is NOT used.
        const availableModels = getAvailableModels();

        // Each option carries its owning provider (Req 4.2). providerOptions are
        // server-only and MUST NOT be sent (Security), so they are dropped here.
        // Order is preserved = allow-list order.
        const models: ChatModelEntry[] = availableModels.map((m) => ({
          key: buildModelKey(m.provider, m.modelId),
          provider: m.provider,
          modelId: m.modelId,
        }));

        // The user's persisted selection (a modelKey). Never trusted as-is: it is
        // used as the initial selection only while it is still in the available
        // set (Req 4.4); an out-of-set (e.g. its provider disabled/misconfigured,
        // Req 4.5), unparseable, or absent value rounds to the effective default.
        // Resolving this server-side keeps the initial selection consistent
        // regardless of the client.
        const userUISettings = await UserUISettings.findOne({
          user: req.user._id,
        }).lean();
        const saved = userUISettings?.aiChatSelectedModelKey;
        const parsedSaved = saved != null ? parseModelKey(saved) : null;
        const isSavedAvailable =
          parsedSaved != null &&
          isModelInAllowList(
            parsedSaved.provider,
            parsedSaved.modelId,
            availableModels,
          );

        // getEffectiveDefaultModelKey throws when the available set is empty. The
        // ai-ready-guard (501) normally prevents that, but if the set was emptied
        // after the guard the throw is caught below and fails soft to 500 rather
        // than returning a response with an undefined selectedModelKey.
        const selectedModelKey =
          isSavedAvailable && saved != null
            ? saved
            : getEffectiveDefaultModelKey();

        const response: ChatModelsResponse = { models, selectedModelKey };
        return res.apiv3(response);
      } catch (err) {
        // 500 (not the apiv3Err default of 400): both the empty-set throw from
        // getEffectiveDefaultModelKey (guard TOCTOU, see comment above) and a
        // genuine failure (e.g. the UserUISettings DB read) are server-side, per
        // the route's Errors contract (501 ai-ready-guard, 500).
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get models'), 500);
      }
    },
  ];
};
