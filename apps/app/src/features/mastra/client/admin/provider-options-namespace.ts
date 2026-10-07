import type { AiProvider } from '../../interfaces/ai-provider';

/**
 * The AI SDK `providerOptions` namespace key each provider's models actually read
 * — verified against the installed `@ai-sdk/*` packages, not assumed from the
 * provider id:
 *   - openai / anthropic / google → the same-named key
 *   - azure-openai → `openai` (its chat model is `OpenAIChatLanguageModel`, which
 *     parses provider options under the `openai` key)
 *
 * This is the single piece of provider knowledge the form has, and it is what
 * lets a freshly added model start from the *correct* namespace for the current
 * provider — replacing the former hard-coded `openai` example that was shown even
 * when the provider was anthropic (a bug).
 */
const PROVIDER_OPTIONS_NAMESPACE: Record<AiProvider, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  'azure-openai': 'openai',
};

/**
 * The providerOptions namespace key for the given provider, or `null` when no
 * provider is selected yet (the `''` sentinel) and the namespace is unknown.
 */
export const getProviderOptionsNamespace = (
  provider: AiProvider | '',
): string | null =>
  provider === '' ? null : PROVIDER_OPTIONS_NAMESPACE[provider];

/**
 * The initial providerOptions text for a newly added model: an empty options
 * object under the current provider's namespace (e.g. `{\n  "anthropic": {}\n}`),
 * ready for the admin to fill in. Empty string when no provider is selected yet
 * (no namespace is known).
 */
export const buildInitialProviderOptionsText = (
  provider: AiProvider | '',
): string => {
  const namespace = getProviderOptionsNamespace(provider);
  if (namespace == null) {
    return '';
  }
  return JSON.stringify({ [namespace]: {} }, null, 2);
};
