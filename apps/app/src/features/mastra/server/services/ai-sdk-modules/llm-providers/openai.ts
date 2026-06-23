import { createOpenAI } from '@ai-sdk/openai';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the OpenAI chat model: explicit apiKey injection only (never the
// provider's process.env auto-detection), then apply the given model id. The
// modelId is passed in by the caller (resolveMastraModel resolves the effective
// model against the allow-list first).
export const resolveOpenaiModel = (modelId: string): MastraModelConfig =>
  createOpenAI({ apiKey: requireApiKey() })(modelId);
