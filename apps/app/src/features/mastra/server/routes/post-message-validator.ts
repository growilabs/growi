import { body, type ValidationChain } from 'express-validator';

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

  body('messages').custom(async (data) => {
    await validateUIMessages({ messages: data });
  }),
];
