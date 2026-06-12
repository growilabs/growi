import { body, type ValidationChain } from 'express-validator';

import { isAiProvider } from '~/features/mastra/interfaces/ai-provider';

/**
 * Returns whether `value` is a string that `JSON.parse` accepts.
 *
 * Extracted as a pure predicate so the parse logic is unit-testable in
 * isolation and reusable from the validator chain. An empty string returns
 * false because there is nothing to parse; the chain treats "empty" as
 * "omitted / cleared" upstream via `.if()` so empty input never reaches here.
 */
export const isParsableJsonString = (value: string): boolean => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * express-validator chain for PUT /_api/v3/ai-settings.
 *
 * All fields are optional because the endpoint accepts partial updates
 * (`AiSettingsUpdateRequest`). The rules enforced here are the formal ones
 * (Req 6.1 / 6.2): the provider must be one of the supported `AI_PROVIDERS`,
 * `providerOptions` must be parsable JSON when present and non-empty, and the
 * boolean toggles must be real booleans. Semantic validity of provider options
 * is the provider integration's responsibility, not this layer's.
 */
export const updateAiSettingsValidators: ValidationChain[] = [
  body('provider')
    .optional()
    .custom((value) => isAiProvider(value))
    .withMessage('provider must be one of the supported AI providers'),

  body('providerOptions')
    .optional()
    // Empty string is a cleared value (normalized to undefined server-side), so
    // skip the JSON check for it; only validate non-empty strings.
    .if((value: unknown) => typeof value === 'string' && value !== '')
    .custom((value: string) => isParsableJsonString(value))
    .withMessage('providerOptions must be a valid JSON string'),

  body('aiEnabled').optional().isBoolean(),

  body('azureOpenaiUseEntraId').optional().isBoolean(),
];
