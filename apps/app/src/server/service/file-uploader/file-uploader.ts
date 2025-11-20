import type { Readable } from 'stream';

import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { ICheckLimitResult } from '~/interfaces/attachment';
import type Crowi from '~/server/crowi';
import { type RespondOptions, ResponseMode } from '~/server/interfaces/attachment';
import { Attachment, type IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';

import type { MultipartUploader } from './multipart-uploader';

const logger = loggerFactory('growi:service:fileUploader');


export type SaveFileParam = {
  filePath: string,
  contentType: string,
  data,
}

export type TemporaryUrl = {
  url: string,
  lifetimeSec: number,
}

export interface FileUploader {
  getIsUploadable(): boolean,
  isWritable(): Promise<boolean>,
  getIsReadable(): boolean,
  isValidUploadSettings(): boolean,
  getFileUploadEnabled(): boolean,
  listFiles(): any,
  saveFile(param: SaveFileParam): Promise<any>,
  deleteFiles(): void,
  getFileUploadTotalLimit(): number,
  getTotalFileSize(): Promise<number>,
  checkLimit(uploadFileSize: number): Promise<ICheckLimitResult>,
  determineResponseMode(): ResponseMode,
  uploadAttachment(readable: Readable, attachment: IAttachmentDocument): Promise<void>,
  respond(res: Response, attachment: IAttachmentDocument, opts?: RespondOptions): void,
  findDeliveryFile(attachment: IAttachmentDocument): Promise<NodeJS.ReadableStream>,
  generateTemporaryUrl(attachment: IAttachmentDocument, opts?: RespondOptions): Promise<TemporaryUrl>,
  createMultipartUploader: (uploadKey: string, maxPartSize: number) => MultipartUploader,
  abortPreviousMultipartUpload: (uploadKey: string, uploadId: string) => Promise<void>
}

export abstract class AbstractFileUploader implements FileUploader {

  private crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  getIsUploadable() {
    return !configManager.getConfig('app:fileUploadDisabled') && this.isValidUploadSettings();
  }

  /**
   * Returns whether write opration to the storage is permitted
   * @returns Whether write opration to the storage is permitted
   */
  async isWritable() {
    const filePath = `${uuidv4()}.growi`;
    const data = 'This file was created during g2g transfer to check write permission. You can safely remove this file.';

    try {
      await this.saveFile({
        filePath,
        contentType: 'text/plain',
        data,
      });
      // TODO: delete tmp file in background

      return true;
    }
    catch (err) {
      logger.error(err);
      return false;
    }
  }

  // File reading is possible even if uploading is disabled
  getIsReadable() {
    return this.isValidUploadSettings();
  }

  abstract isValidUploadSettings(): boolean;

  getFileUploadEnabled() {
    if (!this.getIsUploadable()) {
      return false;
    }

    return !!configManager.getConfig('app:fileUpload');
  }

  abstract listFiles();

  abstract saveFile(param: SaveFileParam);

  abstract deleteFiles();

  /**
   * Returns file upload total limit in bytes.
   * @returns file upload total limit in bytes
   */
  getFileUploadTotalLimit(): number {
    return configManager.getConfig('app:fileUploadTotalLimit');
  }

  /**
   * Get total file size
   * @returns Total file size
   */
  async getTotalFileSize() {
    // Get attachment total file size
    const res = await Attachment.aggregate().group({
      _id: null,
      total: { $sum: '$fileSize' },
    });

    // res is [] if not using
    return res.length === 0 ? 0 : res[0].total;
  }

  /**
   * check the file size limit
   */
  checkLimit(uploadFileSize: number): Promise<ICheckLimitResult> {
    const maxFileSize = configManager.getConfig('app:maxFileSize');
    const totalLimit = this.getFileUploadTotalLimit();
    return this.doCheckLimit(uploadFileSize, maxFileSize, totalLimit);
  }

  /**
   * Check files size limits for all uploaders
   *
   */
  protected async doCheckLimit(uploadFileSize: number, maxFileSize: number, totalLimit: number): Promise<ICheckLimitResult> {
    if (uploadFileSize > maxFileSize) {
      return { isUploadable: false, errorMessage: 'File size exceeds the size limit per file' };
    }

    const usingFilesSize = await this.getTotalFileSize();
    if (usingFilesSize + uploadFileSize > totalLimit) {
      return { isUploadable: false, errorMessage: 'Uploading files reaches limit' };
    }

    return { isUploadable: true };
  }

  /**
   * Determine ResponseMode
   */
  determineResponseMode(): ResponseMode {
    return ResponseMode.RELAY;
  }

  /**
   * Create a multipart uploader for cloud storage
   */
  createMultipartUploader(uploadKey: string, maxPartSize: number): MultipartUploader {
    throw new Error('Multipart upload not available for file upload type');
  }

  abstract uploadAttachment(readable: Readable, attachment: IAttachmentDocument): Promise<void>;

  /**
   * Abort an existing multipart upload without creating a MultipartUploader instance
   */
  abortPreviousMultipartUpload(uploadKey: string, uploadId: string): Promise<void> {
    throw new Error('Multipart upload not available for file upload type');
  }

  /**
   * Respond to the HTTP request.
   */
  abstract respond(res: Response, attachment: IAttachmentDocument, opts?: RespondOptions): void;

  /**
   * Find the file and Return ReadStream
   */
  abstract findDeliveryFile(attachment: IAttachmentDocument): Promise<NodeJS.ReadableStream>;

  /**
   * Generate temporaryUrl that is valid for a very short time
   */
  abstract generateTemporaryUrl(attachment: IAttachmentDocument, opts?: RespondOptions): Promise<TemporaryUrl>;

}
