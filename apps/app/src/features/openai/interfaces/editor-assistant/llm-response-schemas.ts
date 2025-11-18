import { z } from 'zod';

// -----------------------------------------------------------------------------
// Streaming Response Schemas for Editor Assistant
// -----------------------------------------------------------------------------

// Message schema for streaming communication
export const LlmEditorAssistantMessageSchema = z.object({
  message: z
    .string()
    .describe(
      'A friendly message explaining what changes were made or suggested',
    ),
});

// Search/Replace Diff Schema (roo-code compatible)
export const LlmEditorAssistantDiffSchema = z.object({
  search: z
    .string()
    .min(1)
    .describe(
      'Exact content to search for (including whitespace and indentation)',
    ),
  replace: z.string().describe('Content to replace with'),
  startLine: z
    .number()
    .int()
    .positive()
    .describe('Starting line number for search (1-based, REQUIRED)'),
  endLine: z
    .number()
    .int()
    .positive()
    .nullable() // https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required
    .optional()
    .describe('Ending line number for search (1-based, optional)'),
});

// Type definitions
export type LlmEditorAssistantMessage = z.infer<
  typeof LlmEditorAssistantMessageSchema
>;
export type LlmEditorAssistantDiff = z.infer<
  typeof LlmEditorAssistantDiffSchema
>;
