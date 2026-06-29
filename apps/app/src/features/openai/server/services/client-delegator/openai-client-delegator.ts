import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

import { configManager } from '~/server/service/config-manager';

import type { IOpenaiClientDelegator } from './interfaces';

export class OpenaiClientDelegator implements IOpenaiClientDelegator {
  private client: OpenAI;

  constructor() {
    // Retrieve OpenAI related values from environment variables
    const apiKey = configManager.getConfig('openai:apiKey');

    const isValid = [apiKey].every((value) => value != null);
    if (!isValid) {
      throw new Error(
        "Environment variables required to use OpenAI's API are not set",
      );
    }

    // initialize client
    this.client = new OpenAI({ apiKey });
  }

  async chatCompletion(
    body: OpenAI.Chat.Completions.ChatCompletionCreateParams,
  ): Promise<
    | OpenAI.Chat.Completions.ChatCompletion
    | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
  > {
    return this.client.chat.completions.create(body);
  }
}
