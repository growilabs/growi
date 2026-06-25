import type { AllowedModel } from '../../../interfaces/allowed-model';
import { isProviderNamespacedObject } from '../../../utils/provider-options-validation';

/**
 * Pure validator for a NON-EMPTY `allowedModels` list submitted to PUT /ai-settings.
 *
 * Returns `true` when the list satisfies every rule below, `false` otherwise. It is
 * the single source of truth used by the express-validator `.custom()` chain, so the
 * rules can be unit-tested directly without driving the middleware:
 *   - every entry's `modelId` is a non-empty string (Req 1.4)
 *   - no two entries share the same `modelId` (Req 1.4)
 *   - every entry's `providerOptions`, when present, is a provider-namespaced object
 *     (the same shape the runtime applies) (Req 2.4); absent = "no options" (Req 2.3)
 *   - EXACTLY ONE entry has `isDefault === true` — neither 0 nor >1 (Req 1.3 / 1.5)
 *
 * IMPORTANT — this is applied ONLY to a non-empty list. An EMPTY array (or an omitted
 * field) is a legitimate "no allowed models" disablement (the clear path), NOT a
 * validation error, so the isDefault-uniqueness check must never see it: the caller
 * gates on `length > 0` before invoking this. See put-ai-settings buildUpdates and
 * the design "空配列 / 未指定の扱い（クリア経路）" note.
 */
export const isValidNonEmptyAllowedModels = (
  models: readonly AllowedModel[],
): boolean => {
  const ids = new Set<string>();
  let defaultCount = 0;

  for (const entry of models) {
    // modelId must be a non-empty string.
    if (typeof entry.modelId !== 'string' || entry.modelId.trim() === '') {
      return false;
    }
    // No duplicate model ids.
    if (ids.has(entry.modelId)) {
      return false;
    }
    ids.add(entry.modelId);

    // providerOptions (when present) must be a provider-namespaced object. Absent
    // is valid ("no options"); the runtime resolves it to {}.
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

  // Exactly one default. 0 (forces an explicit choice) and >1 (ambiguous) both fail.
  return defaultCount === 1;
};

/**
 * True when `value` is a well-formed `AllowedModel[]` request payload. Used by the
 * express-validator `.custom()` to accept ALL of:
 *   - an array (the shape requirement)
 *   - an EMPTY array — the clear path (a legitimate "no models" disablement; it must
 *     NOT be rejected, and the isDefault-uniqueness rule is NOT applied to it)
 *   - a NON-EMPTY array that passes every `isValidNonEmptyAllowedModels` rule
 *
 * A non-array value (or a non-empty array that breaks a rule) returns `false`, which
 * `apiV3FormValidator` reports as a 400 with the `allowedModels` field flagged (422 is
 * reserved for env-only mode, handled separately in the PUT handler).
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
