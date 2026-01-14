import { z } from 'zod';

import { LlmEditorAssistantDiffSchema } from './llm-response-schemas';

// -----------------------------------------------------------------------------
// SSE Schemas for Streaming Editor Assistant
// -----------------------------------------------------------------------------

// Request schemas
export const EditRequestBodySchema = z.object({
  threadId: z.string(),
  aiAssistantId: z.string().optional(),
  userMessage: z.string(),
  pageBody: z.string(),
  selectedText: z.string().optional(),
  selectedPosition: z.number().optional(),
  isPageBodyPartial: z
    .boolean()
    .optional()
    .describe('Whether the page body is a partial content'),
  partialPageBodyStartIndex: z
    .number()
    .optional()
    .describe('0-based index for the start of the partial page body'),
});

// Type definitions
export type EditRequestBody = z.infer<typeof EditRequestBodySchema>;

export const SseMessageSchema = z.object({
  appendedMessage: z
    .string()
    .describe('The message that should be appended to the chat window'),
});

export const SseDetectedDiffSchema = z.object({
  diff: LlmEditorAssistantDiffSchema,
});

// Simplified finalized schema
export const SseFinalizedSchema = z.object({
  success: z.boolean(),
});

// Type definitions
export type SseMessage = z.infer<typeof SseMessageSchema>;
export type SseDetectedDiff = z.infer<typeof SseDetectedDiffSchema>;
export type SseFinalized = z.infer<typeof SseFinalizedSchema>;
