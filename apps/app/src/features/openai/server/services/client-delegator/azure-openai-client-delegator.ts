import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from '@azure/identity';
import type OpenAI from 'openai';
import { AzureOpenAI } from 'openai';
import type { Stream } from 'openai/streaming';

import type { IOpenaiClientDelegator } from './interfaces';

export class AzureOpenaiClientDelegator implements IOpenaiClientDelegator {
  private client: AzureOpenAI;

  constructor() {
    // Retrieve Azure OpenAI related values from environment variables
    const credential = new DefaultAzureCredential();
    const scope = 'https://cognitiveservices.azure.com/.default';
    const azureADTokenProvider = getBearerTokenProvider(credential, scope);
    this.client = new AzureOpenAI({ azureADTokenProvider });
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
