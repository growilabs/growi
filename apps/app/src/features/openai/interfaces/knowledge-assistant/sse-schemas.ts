import { z } from 'zod';

// Schema definitions
export const SseMessageSchema = z.object({
  content: z.array(
    z.object({
      index: z.number(),
      type: z.string(),
      text: z.object({
        value: z
          .string()
          .describe('The message that should be appended to the chat window'),
      }),
    }),
  ),
});

export const SsePreMessageSchema = z.object({
  text: z
    .string()
    .nullish()
    .describe('The pre-message that should be appended to the chat window'),
  finished: z
    .boolean()
    .describe('Indicates if the pre-message generation is finished'),
});

// Type definitions
export type SseMessage = z.infer<typeof SseMessageSchema>;
export type SsePreMessage = z.infer<typeof SsePreMessageSchema>;
