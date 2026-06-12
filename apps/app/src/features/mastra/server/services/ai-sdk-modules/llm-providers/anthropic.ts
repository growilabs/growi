import { createAnthropic } from '@ai-sdk/anthropic';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey, requireModel } from './config';

// Resolve the Anthropic chat model from config: explicit apiKey injection only
// (never the provider's process.env auto-detection), then apply the model id.
export const resolveAnthropicModel = (): MastraModelConfig =>
  createAnthropic({ apiKey: requireApiKey() })(requireModel());
