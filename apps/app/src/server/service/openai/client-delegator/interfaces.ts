import type OpenAI from 'openai';
import type { Uploadable } from 'openai/uploads';

export interface IOpenaiClientDelegator {
  uploadFile(file: Uploadable): Promise<OpenAI.Files.FileObject>
  createVectorStoreFileBatch(fileIds: string[]): Promise<OpenAI.Beta.VectorStores.FileBatches.VectorStoreFileBatch>
  getVectorStoreFiles(): Promise<OpenAI.Beta.VectorStores.Files.VectorStoreFilesPage>;
  deleteVectorStoreFiles(fileId: string): Promise<OpenAI.Beta.VectorStores.Files.VectorStoreFileDeleted>;
  getFileList(): Promise<OpenAI.Files.FileObjectsPage>;
  deleteFile(fileId: string): Promise<OpenAI.Files.FileDeleted>;
  uploadAndPoll(files: Uploadable[]): Promise<OpenAI.Beta.VectorStores.FileBatches.VectorStoreFileBatch>;
}
