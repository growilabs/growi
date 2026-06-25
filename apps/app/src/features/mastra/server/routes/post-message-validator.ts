import { body, type ValidationChain } from 'express-validator';

import { MAX_MODEL_ID_LENGTH } from '~/features/mastra/interfaces/allowed-model';

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

  // Per-request model selection (Req 3.3). Optional: when omitted the server
  // rounds to the default model. The value is NOT trusted here — the allow-list
  // check lives in resolveEffectiveModelId (run once by the post-message handler,
  // then idempotently by resolveMastraModel), so this only rejects a non-string
  // shape. A length cap is applied as a defensive bound: an out-of-allowlist id is
  // logged verbatim by resolveEffectiveModelId, so an unbounded string would bloat
  // the logs on every request — real model ids are far shorter (MAX_MODEL_ID_LENGTH).
  body('modelId')
    .optional()
    .isString()
    .withMessage('modelId must be a string')
    .isLength({ max: MAX_MODEL_ID_LENGTH })
    .withMessage(`modelId must be at most ${MAX_MODEL_ID_LENGTH} characters`),

  body('messages').custom(async (data) => {
    await validateUIMessages({ messages: data });
  }),
];
