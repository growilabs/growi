import {
  type AllowedModel,
  isModelInAllowList,
} from '~/features/mastra/interfaces/allowed-model';
import {
  buildModelKey,
  type ModelKey,
  parseModelKey,
} from '~/features/mastra/interfaces/model-key';
import loggerFactory from '~/utils/logger';

import { getAvailableModels } from './provider-availability';

const logger = loggerFactory(
  'growi:features:mastra:llm-providers:effective-model-key',
);

// Effective model-key resolution: the effective default and the request-time
// single validation checkpoint (Req 4.6, 6.4). Both operate on the AVAILABLE set
// (enabled ∧ configured providers, via getAvailableModels) rather than the raw
// allow-list, so a model whose owning provider is disabled/misconfigured is never
// selectable and the saved default can fall back deterministically (6.4).
//
// Dependency direction (design "Allowed Dependencies"): config accessor ->
// provider-availability -> effective-model-key. This module therefore imports
// provider-availability; config.ts and provider-availability must NOT import it
// (keeping the one-way dependency and avoiding a config <-> availability cycle).

// Thrown when the available set is empty (every configured provider is disabled
// or misconfigured, or the allow-list has no reachable model). The ai-ready-guard
// normally returns 501 before a chat request reaches here, so this is a defensive
// throw. The message names the situation only — no secrets, no config values.
const NO_AVAILABLE_MODELS_MESSAGE =
  'No available AI model to resolve: every configured provider is disabled or misconfigured, or the allow-list is empty';

// Pick the effective default from an ALREADY-COMPUTED available set: the
// `isDefault` entry, else the first available entry (deterministic — Req 6.4).
// find() over the AVAILABLE set already implements the fallback: if the saved
// default's provider is now unavailable, that entry is absent here, so find()
// misses and we deterministically take the first available entry. Throws when the
// set is empty. Taking the set as input lets resolveEffectiveModelKey reuse the
// list it already holds instead of recomputing availability a second time.
const pickEffectiveDefault = (
  availableModels: readonly AllowedModel[],
): ModelKey => {
  const defaultModel =
    availableModels.find((model) => model.isDefault) ?? availableModels[0];

  if (defaultModel == null) {
    throw new Error(NO_AVAILABLE_MODELS_MESSAGE);
  }

  return buildModelKey(defaultModel.provider, defaultModel.modelId);
};

/**
 * The effective default modelKey: the `isDefault` entry when its owning provider
 * is available, otherwise the first available entry (deterministic — Req 6.4).
 * Throws when the available set is empty.
 */
export const getEffectiveDefaultModelKey = (): ModelKey =>
  pickEffectiveDefault(getAvailableModels());

/**
 * Request-time single validation checkpoint (Req 4.6). Validates the client-
 * supplied modelKey against the available allow-list (the client value is never
 * trusted):
 *  - key in the available set              -> returned unchanged (opaque, valid)
 *  - key out of the available set / omitted / unparseable -> effective default
 *    (a rejected non-null key is audited with a warn carrying the KEY VALUE ONLY)
 *  - 0 available models                    -> throw (ai-ready-guard 501 preempts)
 */
export const resolveEffectiveModelKey = (modelKey?: string): ModelKey => {
  const availableModels = getAvailableModels();

  if (availableModels.length === 0) {
    throw new Error(NO_AVAILABLE_MODELS_MESSAGE);
  }

  if (modelKey != null) {
    const parsed = parseModelKey(modelKey);
    if (
      parsed != null &&
      isModelInAllowList(parsed.provider, parsed.modelId, availableModels)
    ) {
      // Already-valid opaque key: return the client-supplied form verbatim.
      return modelKey;
    }

    // A supplied key that failed the membership check is rounded to the default.
    // Audit the fallback with the rejected KEY VALUE ONLY — no secrets, no config
    // values. This is a per-request audit log, so a plain warn (not warn-dedup).
    // JSON.stringify escapes the client-supplied value (newlines, ANSI escapes,
    // quotes) so it cannot forge log lines or inject terminal control sequences
    // into an operator's console — the validator only bounds its length/type.
    logger.warn(
      `Requested model ${JSON.stringify(modelKey)} is not in the available allow-list; falling back to the effective default model`,
    );
  }

  // Reuse the set already computed above — no second availability sweep.
  return pickEffectiveDefault(availableModels);
};
