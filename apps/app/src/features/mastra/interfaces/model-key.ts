import { type AiProvider, isAiProvider } from './ai-provider';

/**
 * Composite model identifier that crosses layer boundaries, formatted as
 * `${AiProvider}/${modelId}`. Only this module builds and parses the format;
 * every other module treats a ModelKey as an opaque string.
 */
export type ModelKey = string;

/**
 * Maximum accepted length of a client-supplied modelKey (migrated from the
 * former MAX_MODEL_ID_LENGTH). Real model ids / Azure deployment names are far
 * shorter, so this is a generous defensive bound, NOT a semantic limit: it only
 * stops an authenticated client from sending an unbounded string that would be
 * logged or persisted verbatim. The value is still allow-list validated
 * regardless of length, so the cap changes nothing for legitimate keys.
 */
export const MAX_MODEL_KEY_LENGTH = 256;

export const buildModelKey = (
  provider: AiProvider,
  modelId: string,
): ModelKey => `${provider}/${modelId}`;

/**
 * Split a modelKey at the FIRST '/'. Returns null when the prefix is not a
 * supported AiProvider, the modelId part is empty, or no separator exists.
 * A '/' inside the modelId part is allowed (it belongs to the modelId), so
 * `parseModelKey(buildModelKey(p, id))` round-trips for any non-empty id.
 */
export const parseModelKey = (
  key: string,
): { provider: AiProvider; modelId: string } | null => {
  const separatorIndex = key.indexOf('/');
  if (separatorIndex === -1) {
    return null;
  }

  const provider = key.slice(0, separatorIndex);
  const modelId = key.slice(separatorIndex + 1);

  if (!isAiProvider(provider) || modelId === '') {
    return null;
  }

  return { provider, modelId };
};
