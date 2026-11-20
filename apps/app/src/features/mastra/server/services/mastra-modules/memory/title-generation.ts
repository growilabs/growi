import type { MastraModelConfig } from '@mastra/core/llm';
import type { RequestContext } from '@mastra/core/request-context';

import { resolveMastraModel } from '../../ai-sdk-modules/resolve-mastra-model';
import { meterModelPerCall } from '../../usage-metering';
import type { MastraRequestContextShape } from '../types/request-context';

/**
 * Memory's `generateTitle` option. Titles are still generated automatically
 * with the request's model; only that model is wrapped, so that each title
 * generation is recorded on its own as `thread-title`, never added to the
 * chat's usage meter that shares the same request context.
 */
export const titleGeneration = {
  model: async ({
    requestContext,
  }: {
    requestContext: RequestContext;
  }): Promise<MastraModelConfig> => {
    // Memory's options carry no request-context type; the chat handler that
    // starts the run writes this shape.
    const context: Pick<
      RequestContext<MastraRequestContextShape>,
      'get'
    > = requestContext;
    return meterModelPerCall(
      context,
      'thread-title',
      await resolveMastraModel(context.get('modelKey')),
    );
  },
};
