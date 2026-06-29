import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

export interface IOpenaiClientDelegator {
  chatCompletion(
    body: OpenAI.Chat.Completions.ChatCompletionCreateParams,
  ): Promise<
    | OpenAI.Chat.Completions.ChatCompletion
    | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
  >;
}
