import type { MastraModelConfig } from '@mastra/core/llm';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';

import { resolveAnthropicModel } from './anthropic';
import { resolveAzureOpenaiModel } from './azure-openai';
import { resolveGoogleModel } from './google';
import { resolveOpenaiModel } from './openai';

// Data-driven provider -> self-contained model resolver. Every entry is a
// uniform (model: string) => MastraModelConfig, so the consumer
// (resolveMastraModel) dispatches generically with zero per-provider knowledge —
// adding a provider is a new module + one entry here + the AiProvider union
// member, and the consumer never changes (see .claude/rules/coding-style.md
// "Data-Driven Control over Hard-Coded Mode Checks"). The model id is supplied by
// the caller (the effective model, already validated against the allow-list);
// each provider reads only its own non-model config, and non-uniform needs (e.g.
// the Azure endpoint / Entra ID) stay inside that provider's resolver.
//
// The values are functions called at use time, so importing this module never
// reads config or throws — app boot is unaffected by misconfiguration.
export const modelResolvers: Record<
  AiProvider,
  (model: string) => MastraModelConfig
> = {
  openai: resolveOpenaiModel,
  anthropic: resolveAnthropicModel,
  google: resolveGoogleModel,
  'azure-openai': resolveAzureOpenaiModel,
};
