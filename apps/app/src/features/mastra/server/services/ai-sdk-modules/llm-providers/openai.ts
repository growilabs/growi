import { createOpenAI } from '@ai-sdk/openai';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the OpenAI chat model: explicit apiKey injection only (never the
// provider's process.env auto-detection), then apply the given model id. The
// key is read for THIS provider (requireApiKey('openai')); the modelId is passed
// in by the caller (resolveMastraModel parses the effective modelKey and dispatches
// the bare modelId here).
export const resolveOpenaiModel = (modelId: string): MastraModelConfig =>
  createOpenAI({ apiKey: requireApiKey('openai') })(modelId);
