import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import type { Uploadable } from 'openai/uploads';

import type { MessageListParams } from '../../../interfaces/message';

export interface IOpenaiClientDelegator {
  createThread(vectorStoreId?: string): Promise<OpenAI.Beta.Threads.Thread>;
  updateThread(
    threadId: string,
    vectorStoreId: string,
  ): Promise<OpenAI.Beta.Threads.Thread>;
  retrieveThread(threadId: string): Promise<OpenAI.Beta.Threads.Thread>;
  deleteThread(threadId: string): Promise<OpenAI.Beta.Threads.ThreadDeleted>;
  getMessages(
    threadId: string,
    options?: MessageListParams,
  ): Promise<OpenAI.Beta.Threads.Messages.MessagesPage>;
  retrieveVectorStore(
    vectorStoreId: string,
  ): Promise<OpenAI.VectorStores.VectorStore>;
  createVectorStore(name: string): Promise<OpenAI.VectorStores.VectorStore>;
  deleteVectorStore(
    vectorStoreId: string,
  ): Promise<OpenAI.VectorStores.VectorStoreDeleted>;
  uploadFile(file: Uploadable): Promise<OpenAI.Files.FileObject>;
  createVectorStoreFile(
    vectorStoreId: string,
    fileId: string,
  ): Promise<OpenAI.VectorStores.Files.VectorStoreFile>;
  createVectorStoreFileBatch(
    vectorStoreId: string,
    fileIds: string[],
  ): Promise<OpenAI.VectorStores.FileBatches.VectorStoreFileBatch>;
  deleteFile(fileId: string): Promise<OpenAI.Files.FileDeleted>;
  chatCompletion(
    body: OpenAI.Chat.Completions.ChatCompletionCreateParams,
  ): Promise<
    | OpenAI.Chat.Completions.ChatCompletion
    | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
  >;
}
