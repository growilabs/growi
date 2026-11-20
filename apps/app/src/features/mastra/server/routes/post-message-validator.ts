import { body, type ValidationChain } from 'express-validator';

import { MAX_MODEL_KEY_LENGTH } from '~/features/mastra/interfaces/model-key';

// Signature of `validateUIMessages` from the `ai` package, injected by the
// caller so this module stays free of the `ai` runtime dependency (and remains
// unit-testable in isolation).
type ValidateUIMessages = (input: { messages: unknown }) => Promise<unknown>;

// Build the validator chain for POST /_api/v3/mastra/message.
//
// The endpoint is assistant-independent: it does NOT accept or require an
// `aiAssistantId`. A legacy `aiAssistantId` present in the body is simply
// ignored because no field is declared for it.
export const buildPostMessageValidator = (
  validateUIMessages: ValidateUIMessages,
): ValidationChain[] => [
  body('threadId')
    .isUUID()
    .optional()
    .withMessage('threadId must be a valid UUID'),

  // Per-request model selection (Req 4.3, 4.6). Optional: when omitted the server
  // rounds to the default model. The value is NOT trusted here — the semantic
  // allow-list check lives in resolveEffectiveModelKey (run once by the post-message
  // handler, then idempotently by resolveMastraModel), so this only rejects a
  // non-string shape (single-checkpoint principle: no semantic validation here). A
  // length cap is applied as a defensive bound: an out-of-allowlist key is logged
  // verbatim by resolveEffectiveModelKey, so an unbounded string would bloat the
  // logs on every request — real model keys are far shorter (MAX_MODEL_KEY_LENGTH).
  body('modelKey')
    .optional()
    .isString()
    .withMessage('modelKey must be a string')
    .isLength({ max: MAX_MODEL_KEY_LENGTH })
    .withMessage(`modelKey must be at most ${MAX_MODEL_KEY_LENGTH} characters`),

  body('messages').custom(async (data) => {
    await validateUIMessages({ messages: data });
  }),
];
