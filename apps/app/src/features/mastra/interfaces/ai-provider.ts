// Server-only type module: the single source of truth for the supported LLM
// provider set. Do NOT add client imports here.

export const AI_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'azure-openai',
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const isAiProvider = (value: unknown): value is AiProvider =>
  typeof value === 'string' &&
  (AI_PROVIDERS as readonly string[]).includes(value);
