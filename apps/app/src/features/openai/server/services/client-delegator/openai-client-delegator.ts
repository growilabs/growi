import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { Uploadable } from 'openai/uploads';

import { configManager } from '~/server/service/config-manager';

import type { MessageListParams } from '../../../interfaces/message';

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

  async createThread(
    vectorStoreId?: string,
  ): Promise<OpenAI.Beta.Threads.Thread> {
    return this.client.beta.threads.create(
      vectorStoreId != null
        ? {
            tool_resources: {
              file_search: {
                vector_store_ids: [vectorStoreId],
              },
            },
          }
        : undefined,
    );
  }

  async retrieveThread(threadId: string): Promise<OpenAI.Beta.Threads.Thread> {
    return this.client.beta.threads.retrieve(threadId);
  }

  async updateThread(
    threadId: string,
    vectorStoreId: string,
  ): Promise<OpenAI.Beta.Threads.Thread> {
    return this.client.beta.threads.update(threadId, {
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      },
    });
  }

  async deleteThread(
    threadId: string,
  ): Promise<OpenAI.Beta.Threads.ThreadDeleted> {
    return this.client.beta.threads.del(threadId);
  }

  async getMessages(
    threadId: string,
    options?: MessageListParams,
  ): Promise<OpenAI.Beta.Threads.Messages.MessagesPage> {
    return this.client.beta.threads.messages.list(threadId, {
      order: options?.order,
      limit: options?.limit,
      before: options?.before,
      after: options?.after,
    });
  }

  async createVectorStore(
    name: string,
  ): Promise<OpenAI.VectorStores.VectorStore> {
    return this.client.vectorStores.create({
      name: `growi-vector-store-for-${name}`,
    });
  }

  async retrieveVectorStore(
    vectorStoreId: string,
  ): Promise<OpenAI.VectorStores.VectorStore> {
    return this.client.vectorStores.retrieve(vectorStoreId);
  }

  async deleteVectorStore(
    vectorStoreId: string,
  ): Promise<OpenAI.VectorStores.VectorStoreDeleted> {
    return this.client.vectorStores.del(vectorStoreId);
  }

  async uploadFile(file: Uploadable): Promise<OpenAI.Files.FileObject> {
    return this.client.files.create({ file, purpose: 'assistants' });
  }

  async createVectorStoreFile(
    vectorStoreId: string,
    fileId: string,
  ): Promise<OpenAI.VectorStores.Files.VectorStoreFile> {
    return this.client.vectorStores.files.create(vectorStoreId, {
      file_id: fileId,
    });
  }

  async createVectorStoreFileBatch(
    vectorStoreId: string,
    fileIds: string[],
  ): Promise<OpenAI.VectorStores.FileBatches.VectorStoreFileBatch> {
    return this.client.vectorStores.fileBatches.create(vectorStoreId, {
      file_ids: fileIds,
    });
  }

  async deleteFile(fileId: string): Promise<OpenAI.Files.FileDeleted> {
    return this.client.files.del(fileId);
  }

  async uploadAndPoll(
    vectorStoreId: string,
    files: Uploadable[],
  ): Promise<OpenAI.VectorStores.FileBatches.VectorStoreFileBatch> {
    return this.client.vectorStores.fileBatches.uploadAndPoll(vectorStoreId, {
      files,
    });
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
