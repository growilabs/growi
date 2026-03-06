import type { Response } from 'express';
import type { Readable } from 'stream';

import type { ICheckLimitResult } from '~/interfaces/attachment';
import type Crowi from '~/server/crowi';
import type { RespondOptions } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';

import {
  AbstractFileUploader,
  type SaveFileParam,
  type TemporaryUrl,
} from './file-uploader';

/**
 * NoneFileUploader is a placeholder uploader when file upload is disabled.
 * All write operations are disabled, but read operations return empty results.
 */
class NoneFileUploader extends AbstractFileUploader {
  /**
   * @inheritdoc
   */
  override getIsUploadable(): boolean {
    return false;
  }

  /**
   * @inheritdoc
   */
  override isValidUploadSettings(): boolean {
    return false;
  }

  /**
   * @inheritdoc
   */
  override async isWritable(): Promise<boolean> {
    return false;
  }

  /**
   * @inheritdoc
   */
  override getIsReadable(): boolean {
    return false;
  }

  /**
   * @inheritdoc
   */
  override listFiles(): [] {
    return [];
  }

  /**
   * @inheritdoc
   */
  override saveFile(_param: SaveFileParam): Promise<void> {
    throw new Error('File upload is disabled');
  }

  /**
   * @inheritdoc
   */
  override deleteFile(_attachment: IAttachmentDocument): void {
    throw new Error('File upload is disabled');
  }

  /**
   * @inheritdoc
   */
  override deleteFiles(_attachments: IAttachmentDocument[]): void {
    throw new Error('File upload is disabled');
  }

  /**
   * @inheritdoc
   */
  override checkLimit(_uploadFileSize: number): Promise<ICheckLimitResult> {
    return Promise.resolve({
      isUploadable: false,
      errorMessage: 'File upload is disabled',
    });
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(
    _readable: Readable,
    _attachment: IAttachmentDocument,
  ): Promise<void> {
    throw new Error('File upload is disabled');
  }

  /**
   * @inheritdoc
   */
  override respond(
    res: Response,
    _attachment: IAttachmentDocument,
    _opts?: RespondOptions,
  ): void {
    res.status(404).send('File upload is disabled');
  }

  /**
   * @inheritdoc
   */
  override findDeliveryFile(
    _attachment: IAttachmentDocument,
  ): Promise<NodeJS.ReadableStream> {
    throw new Error('File upload is disabled');
  }

  /**
   * @inheritdoc
   */
  override generateTemporaryUrl(
    _attachment: IAttachmentDocument,
    _opts?: RespondOptions,
  ): Promise<TemporaryUrl> {
    throw new Error('File upload is disabled');
  }
}

module.exports = (crowi: Crowi) => {
  return new NoneFileUploader(crowi);
};
