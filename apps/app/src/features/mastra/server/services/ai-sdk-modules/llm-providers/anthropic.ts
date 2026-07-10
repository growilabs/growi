import { createAnthropic } from '@ai-sdk/anthropic';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the Anthropic chat model: explicit apiKey injection only (never the
// provider's process.env auto-detection), then apply the given model id. The
// key is read for THIS provider (requireApiKey('anthropic')); the modelId is passed
// in by the caller (resolveMastraModel parses the effective modelKey and dispatches
// the bare modelId here).
export const resolveAnthropicModel = (modelId: string): MastraModelConfig =>
  createAnthropic({ apiKey: requireApiKey('anthropic') })(modelId);
