import type { Ref } from './common';
import type { HasObjectId } from './has-object-id';
import type { IPage } from './page';
import type { IUser } from './user';

export type IAttachment = {
  page?: Ref<IPage>;
  creator?: Ref<IUser>;
  filePath?: string; // DEPRECATED: remains for backward compatibility for v3.3.x or below
  fileName: string;
  fileFormat: string;
  fileSize: number;
  originalName: string;
  temporaryUrlCached?: string;
  temporaryUrlExpiredAt?: Date;
  attachmentType: string;

  createdAt: Date;

  // virtual property
  filePathProxied: string;
  downloadPathProxied: string;
};

export type IAttachmentHasId = IAttachment & HasObjectId;
