import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import type OpenAI from 'openai';
import { AzureOpenAI } from 'openai';
import { type Uploadable } from 'openai/uploads';

import type { MessageListParams } from '../../../interfaces/message';


import type { IOpenaiClientDelegator } from './interfaces';


export class AzureOpenaiClientDelegator implements IOpenaiClientDelegator {

  private client: AzureOpenAI;

  constructor() {
    // Retrieve Azure OpenAI related values from environment variables
    const credential = new DefaultAzureCredential();
    const scope = 'https://cognitiveservices.azure.com/.default';
    const azureADTokenProvider = getBearerTokenProvider(credential, scope);
    this.client = new AzureOpenAI({ azureADTokenProvider });

    // TODO: initialize openaiVectorStoreId property
  }

  async createThread(vectorStoreId: string): Promise<OpenAI.Beta.Threads.Thread> {
    return this.client.beta.threads.create({
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      },
    });
  }

  async updateThread(threadId: string, vectorStoreId: string): Promise<OpenAI.Beta.Threads.Thread> {
    return this.client.beta.threads.update(threadId, {
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      },
    });
  }

  async retrieveThread(threadId: string): Promise<OpenAI.Beta.Threads.Thread> {
    return this.client.beta.threads.retrieve(threadId);
  }

  async deleteThread(threadId: string): Promise<OpenAI.Beta.Threads.ThreadDeleted> {
    return this.client.beta.threads.del(threadId);
  }

  async getMessages(threadId: string, options?: MessageListParams): Promise<OpenAI.Beta.Threads.Messages.MessagesPage> {
    return this.client.beta.threads.messages.list(threadId, {
      order: options?.order,
      limit: options?.limit,
      before: options?.before,
      after: options?.after,
    });
  }

  async createVectorStore(name: string): Promise<OpenAI.Beta.VectorStores.VectorStore> {
    return this.client.beta.vectorStores.create({ name: `growi-vector-store-for-${name}` });
  }

  async retrieveVectorStore(vectorStoreId: string): Promise<OpenAI.Beta.VectorStores.VectorStore> {
    return this.client.beta.vectorStores.retrieve(vectorStoreId);
  }

  async deleteVectorStore(vectorStoreId: string): Promise<OpenAI.Beta.VectorStores.VectorStoreDeleted> {
    return this.client.beta.vectorStores.del(vectorStoreId);
  }

  async uploadFile(file: Uploadable): Promise<OpenAI.Files.FileObject> {
    return this.client.files.create({ file, purpose: 'assistants' });
  }

  async createVectorStoreFileBatch(vectorStoreId: string, fileIds: string[]): Promise<OpenAI.Beta.VectorStores.FileBatches.VectorStoreFileBatch> {
    return this.client.beta.vectorStores.fileBatches.create(vectorStoreId, { file_ids: fileIds });
  }

  async deleteFile(fileId: string): Promise<OpenAI.Files.FileDeleted> {
    return this.client.files.del(fileId);
  }

  async uploadAndPoll(vectorStoreId: string, files: Uploadable[]): Promise<OpenAI.Beta.VectorStores.FileBatches.VectorStoreFileBatch> {
    return this.client.beta.vectorStores.fileBatches.uploadAndPoll(vectorStoreId, { files });
  }

  async chatCompletion(body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return this.client.chat.completions.create(body);
  }

}
