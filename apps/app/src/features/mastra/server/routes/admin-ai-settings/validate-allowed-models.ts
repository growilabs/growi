import { isAiProvider } from '../../../interfaces/ai-provider';
import type { AllowedModel } from '../../../interfaces/allowed-model';
import { MAX_MODEL_KEY_LENGTH } from '../../../interfaces/model-key';
import { isProviderNamespacedObject } from '../../../utils/provider-options-validation';

// The only properties an allow-list entry may carry. Any other property is
// rejected so an attacker-chosen key / blob cannot be persisted verbatim into the
// ai:allowedModels config document (security.md: validate the input shape).
const ALLOWED_ENTRY_KEYS: ReadonlySet<string> = new Set([
  'provider',
  'modelId',
  'providerOptions',
  'isDefault',
]);

/**
 * Pure validator for a NON-EMPTY `allowedModels` list submitted to PUT /ai-settings.
 *
 * Returns `true` when the list satisfies every rule below, `false` otherwise. It is
 * the single source of truth used by the express-validator `.custom()` chain, so the
 * rules can be unit-tested directly without driving the middleware:
 *   - every entry is an object carrying ONLY the declared keys (unknown properties
 *     are rejected so nothing outside the shape is persisted verbatim)
 *   - every entry's `provider` is one of the supported providers (Req 2.5)
 *   - every entry's `modelId` is a non-empty string within the length bound
 *   - no two entries share the same (provider, modelId) pair — the same modelId may
 *     coexist under DIFFERENT providers (Req 2.3) but not under the SAME one (Req 2.4)
 *   - every entry's `providerOptions`, when present, is a provider-namespaced object
 *     (the same shape the runtime applies) (Req 2.8); absent = "no options"
 *   - EXACTLY ONE entry has `isDefault === true` — neither 0 nor >1 (Req 3.2)
 *
 * IMPORTANT — this is applied ONLY to a non-empty list. An EMPTY array (or an omitted
 * field) is a legitimate "no allowed models" state (Req 3.3 — staged setup / removing
 * every model), NOT a validation error, so the isDefault-uniqueness check must never
 * see it: the caller gates on `length > 0` before invoking this. See put-ai-settings
 * buildUpdates and the design "validate-allowed-models" note.
 */
export const isValidNonEmptyAllowedModels = (
  models: readonly AllowedModel[],
): boolean => {
  const seenPairs = new Set<string>();
  let defaultCount = 0;

  for (const entry of models) {
    // The runtime value is client-supplied JSON, so reject a non-object entry
    // (null / primitive) before reading its fields, and reject any unknown extra
    // property so nothing outside the declared shape is persisted verbatim.
    if (entry == null || typeof entry !== 'object') {
      return false;
    }
    if (Object.keys(entry).some((key) => !ALLOWED_ENTRY_KEYS.has(key))) {
      return false;
    }

    // provider must be one of the supported providers (Req 2.5). The type says
    // AiProvider, but the runtime value is client-supplied JSON, so validate it.
    if (!isAiProvider(entry.provider)) {
      return false;
    }

    // modelId must be a non-empty string within the defensive length bound (the
    // same cap the chat modelKey uses — a longer id could never form a valid key).
    if (
      typeof entry.modelId !== 'string' ||
      entry.modelId.trim() === '' ||
      entry.modelId.length > MAX_MODEL_KEY_LENGTH
    ) {
      return false;
    }

    // (provider, modelId) must be unique: the same modelId coexists under
    // DIFFERENT providers (Req 2.3), but a duplicate under the SAME provider is
    // rejected (Req 2.4). \0 delimits the composite key because provider is a
    // fixed enum (never contains \0) while modelId may contain "/", so a printable
    // separator could collide across entries.
    const pairKey = `${entry.provider}\0${entry.modelId}`;
    if (seenPairs.has(pairKey)) {
      return false;
    }
    seenPairs.add(pairKey);

    // providerOptions (when present) must be a provider-namespaced object (Req 2.8).
    // Absent is valid ("no options"); the runtime resolves it to {}.
    if (
      entry.providerOptions != null &&
      !isProviderNamespacedObject(entry.providerOptions)
    ) {
      return false;
    }

    if (entry.isDefault === true) {
      defaultCount += 1;
    }
  }

  // Exactly one default across the non-empty list. 0 (forces an explicit choice)
  // and >1 (ambiguous) both fail (Req 3.2).
  return defaultCount === 1;
};

/**
 * True when `value` is a well-formed `AllowedModel[]` request payload. Used by the
 * express-validator `.custom()` to accept ALL of:
 *   - an array (the shape requirement)
 *   - an EMPTY array — a legitimate "no allowed models" state that must NOT be
 *     rejected, and to which the isDefault-uniqueness rule does NOT apply (Req 3.3)
 *   - a NON-EMPTY array that passes every `isValidNonEmptyAllowedModels` rule
 *
 * `value` is `unknown` because the payload is client-supplied JSON: a non-array value
 * (or a non-empty array that breaks a rule, e.g. an unsupported provider) returns
 * `false`, which `apiV3FormValidator` reports as a 400 with the `allowedModels` field
 * flagged (422 is reserved for env-only mode, handled separately in the PUT handler).
 */
export const isValidAllowedModelsRequest = (value: unknown): boolean => {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length === 0) {
    return true;
  }
  return isValidNonEmptyAllowedModels(value as AllowedModel[]);
};
