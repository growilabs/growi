// Server-only type module: the single source of truth for the supported LLM
// provider set. Do NOT add client imports here.

export const LLM_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const isLlmProvider = (value: unknown): value is LlmProvider =>
  typeof value === 'string' &&
  (LLM_PROVIDERS as readonly string[]).includes(value);
