// The only chat integration module that touches the AI stack. Loaded solely
// through `load-growi-ai-runtime.ts`'s dynamic import(), never statically.
import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';

import { createUsageMeter } from '~/features/ai-usage/server';
import { getEffectiveDefaultModelKey } from '~/features/mastra/server/services/ai-sdk-modules/llm-providers/effective-model-key';
import { getProviderOptionsForModel } from '~/features/mastra/server/services/ai-sdk-modules/resolve-provider-options';
import { getOrCreateThread } from '~/features/mastra/server/services/get-or-create-thread';
import { mastra } from '~/features/mastra/server/services/mastra-modules';
import type { MastraRequestContextShape } from '~/features/mastra/server/services/mastra-modules/types/request-context';
import type SearchService from '~/server/service/search';

import type { GrowiAiRun, GrowiAiRuntime } from './growi-ai-gateway-types';

// Mirrors the browser chat's per-request setup (mastra/server/routes/post-message.ts):
// the user the tools read as, the search service, the default model and a
// usage meter recorded as 'chat'.
const beginRunFor =
  (searchService: SearchService) =>
  (user: IUserHasId): GrowiAiRun => {
    const modelKey = getEffectiveDefaultModelKey();
    const usageMeter = createUsageMeter({
      userId: user._id.toString(),
      feature: 'chat',
      modelKey,
    });
    const requestContext = new RequestContext<MastraRequestContextShape>();
    requestContext.set('user', user);
    requestContext.set('searchService', searchService);
    requestContext.set('modelKey', modelKey);
    requestContext.set('usageMeter', usageMeter);
    return {
      requestContext,
      providerOptions: getProviderOptionsForModel(modelKey),
      finish: (outcome) => usageMeter.close({ outcome }),
    };
  };

export const createGrowiAiRuntime = (
  searchService: SearchService,
): GrowiAiRuntime => ({
  agent: mastra.getAgent('growiAgent'),
  getOrCreateThread,
  beginRun: beginRunFor(searchService),
});
