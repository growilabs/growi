import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

type ChatCompletionResponse = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionStreamResponse =
  Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;

// Type guard function
export const isStreamResponse = (
  result: ChatCompletionResponse | ChatCompletionStreamResponse,
): result is ChatCompletionStreamResponse => {
  // Type assertion is safe due to the constrained input types
  const assertedResult = result as any;
  return assertedResult.tee != null && assertedResult.toReadableStream != null;
};
