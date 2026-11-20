import type { MastraModelConfig } from '@mastra/core/llm';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';

import { resolveAnthropicModel } from './anthropic';
import { resolveAzureOpenaiModel } from './azure-openai';
import { resolveGoogleModel } from './google';
import { resolveOpenaiModel } from './openai';

// Data-driven provider -> self-contained model resolver. Every entry is a
// uniform (modelId: string) => Promise<MastraModelConfig>, so the consumer
// (resolveMastraModel) dispatches generically with zero per-provider knowledge —
// adding a provider is a new module + one entry here + the AiProvider union
// member, and the consumer never changes (see .claude/rules/coding-style.md
// "Data-Driven Control over Hard-Coded Mode Checks"). The model id is supplied by
// the caller (the effective model, already validated against the allow-list);
// each provider reads only its own non-model config, and non-uniform needs (e.g.
// the Azure endpoint / Entra ID) stay inside that provider's resolver.
//
// The values are functions called at use time, so importing this module never
// reads config or throws — app boot is unaffected by misconfiguration. Each
// resolver also loads its `@ai-sdk/*` provider SDK via dynamic import() inside
// the function (hence the Promise return), so importing this module does NOT pull
// any provider graph: only the SDK of the provider actually resolved is loaded,
// keeping the memory cost of the unused providers off the process.
export const modelResolvers: Record<
  AiProvider,
  (modelId: string) => Promise<MastraModelConfig>
> = {
  openai: resolveOpenaiModel,
  anthropic: resolveAnthropicModel,
  google: resolveGoogleModel,
  'azure-openai': resolveAzureOpenaiModel,
};
