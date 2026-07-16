import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the Google Generative AI chat model: explicit apiKey injection only
// (never the provider's process.env auto-detection), then apply the given model
// id. The key is read for THIS provider (requireApiKey('google')); the modelId is
// passed in by the caller (resolveMastraModel parses the effective modelKey and
// dispatches the bare modelId here).
export const resolveGoogleModel = (modelId: string): MastraModelConfig =>
  createGoogleGenerativeAI({ apiKey: requireApiKey('google') })(modelId);
