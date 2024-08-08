import { randomUUID } from 'crypto';
import type { ReadStream } from 'fs';

import type { Response } from 'express';

import type { ICheckLimitResult } from '~/interfaces/attachment';
import { type RespondOptions, ResponseMode } from '~/server/interfaces/attachment';
import { Attachment, type IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';

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
  doCheckLimit(uploadFileSize: number, maxFileSize: number, totalLimit: number): Promise<ICheckLimitResult>,
  determineResponseMode(): ResponseMode,
  uploadAttachment(readStream: ReadStream, attachment: IAttachmentDocument): Promise<void>,
  respond(res: Response, attachment: IAttachmentDocument, opts?: RespondOptions): void,
  findDeliveryFile(attachment: IAttachmentDocument): Promise<NodeJS.ReadableStream>,
  generateTemporaryUrl(attachment: IAttachmentDocument, opts?: RespondOptions): Promise<TemporaryUrl>,
}

export abstract class AbstractFileUploader implements FileUploader {

  private crowi;

  constructor(crowi) {
    this.crowi = crowi;
  }

  getIsUploadable() {
    return !configManager.getConfig('crowi', 'app:fileUploadDisabled') && this.isValidUploadSettings();
  }

  /**
   * Returns whether write opration to the storage is permitted
   * @returns Whether write opration to the storage is permitted
   */
  async isWritable() {
    const filePath = `${randomUUID()}.growi`;
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

    return !!configManager.getConfig('crowi', 'app:fileUpload');
  }

  abstract listFiles();

  abstract saveFile(param: SaveFileParam);

  abstract deleteFiles();

  /**
   * Returns file upload total limit in bytes.
   * Reference to previous implementation is
   * {@link https://github.com/weseek/growi/blob/798e44f14ad01544c1d75ba83d4dfb321a94aa0b/src/server/service/file-uploader/gridfs.js#L86-L88}
   * @returns file upload total limit in bytes
   */
  getFileUploadTotalLimit() {
    const fileUploadTotalLimit = configManager.getConfig('crowi', 'app:fileUploadType') === 'mongodb'
      // Use app:fileUploadTotalLimit if gridfs:totalLimit is null (default for gridfs:totalLimit is null)
      ? configManager.getConfig('crowi', 'gridfs:totalLimit') ?? configManager.getConfig('crowi', 'app:fileUploadTotalLimit')
      : configManager.getConfig('crowi', 'app:fileUploadTotalLimit');
    return fileUploadTotalLimit;
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
   * Check files size limits for all uploaders
   *
   */
  async doCheckLimit(uploadFileSize: number, maxFileSize: number, totalLimit: number): Promise<ICheckLimitResult> {
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

 abstract uploadAttachment(readStream: ReadStream, attachment: IAttachmentDocument): Promise<void>;

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
