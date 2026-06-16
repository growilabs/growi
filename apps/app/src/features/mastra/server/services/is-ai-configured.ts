import { isAiEnabled } from '~/features/openai/server/services';

import { resolveMastraModel } from './ai-sdk-modules/resolve-mastra-model';

// Decide "is AI configured?" by attempting to resolve the model rather than
// re-implementing the per-provider required-field checks. resolveMastraModel is
// the single source of that truth (it throws on an unsupported provider or
// missing required config), so wrapping it in try/catch keeps this verdict
// structurally identical to what the AI runtime would do — the criteria cannot
// drift apart. The cost is near-zero per request: a configured model is memoized
// (cache hit), and an unconfigured one throws during validation before any model
// is built. The error is swallowed because callers (guard, sidebar supplier)
// only need a boolean and the message may reference provider internals.
export const isAiConfigured = (): boolean => {
  try {
    resolveMastraModel();
    return true;
  } catch {
    return false;
  }
};

// AI is usable only when it is both turned on and configured. Single verdict
// shared by the mastra route guard and the sidebar supplier.
export const isAiReady = (): boolean => isAiEnabled() && isAiConfigured();
