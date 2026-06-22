import { createAnthropic } from '@ai-sdk/anthropic';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the Anthropic chat model: explicit apiKey injection only (never the
// provider's process.env auto-detection), then apply the given model id. The
// model is passed in by the caller (resolveMastraModel resolves the effective
// model against the allow-list first).
export const resolveAnthropicModel = (model: string): MastraModelConfig =>
  createAnthropic({ apiKey: requireApiKey() })(model);
