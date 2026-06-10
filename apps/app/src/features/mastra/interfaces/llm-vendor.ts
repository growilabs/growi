// Server-only type module: the single source of truth for the supported LLM
// vendor set. Do NOT add client imports here.

export const LLM_VENDORS = ['openai', 'anthropic', 'google'] as const;
export type LlmVendor = (typeof LLM_VENDORS)[number];

export const isLlmVendor = (value: unknown): value is LlmVendor =>
  typeof value === 'string' &&
  (LLM_VENDORS as readonly string[]).includes(value);
