import type { Bucket, File } from '@google-cloud/storage';
// eslint-disable-next-line no-restricted-imports
import axios from 'axios';

import loggerFactory from '~/utils/logger';

import { MultipartUploader, UploadStatus, type IMultipartUploader } from '../multipart-uploader';

const logger = loggerFactory('growi:services:fileUploaderGcs:multipartUploader');

export type IGcsMultipartUploader = IMultipartUploader

/**
 * Class for uploading files to GCS using multipart upload.
 * Create instance from GcsFileUploader class.
 * Each instance can only be used for one multipart upload, and cannot be reused once completed.
 * TODO: Enable creation of uploader of inturrupted uploads: https://redmine.weseek.co.jp/issues/78040
 */
export class GcsMultipartUploader extends MultipartUploader implements IGcsMultipartUploader {

  private file: File;

  // ref: https://cloud.google.com/storage/docs/performing-resumable-uploads?hl=en#chunked-upload
  private readonly minPartSize = 256 * 1024; // 256KB

  constructor(bucket: Bucket, uploadKey: string, maxPartSize: number) {
    super(uploadKey, maxPartSize);

    this.file = bucket.file(this.uploadKey);
  }

  async initUpload(): Promise<void> {
    this.validateUploadStatus(UploadStatus.BEFORE_INIT);

    const [uploadUrl] = await this.file.createResumableUpload();

    this._uploadId = uploadUrl;
    this.currentStatus = UploadStatus.IN_PROGRESS;
    logger.info(`Multipart upload initialized. Upload key: ${this.uploadKey}`);
  }

  async uploadPart(part: Buffer, partNumber: number): Promise<void> {
    this.validateUploadStatus(UploadStatus.IN_PROGRESS);
    this.validatePartSize(part.length);

    // Upload the whole part in one request, or divide it in chunks and upload depending on the part size
    if (part.length === this.maxPartSize) {
      await this.uploadChunk(part);
    }
    else if (this.minPartSize < part.length && part.length < this.maxPartSize) {
      const numOfMinPartSize = Math.floor(part.length / this.minPartSize);
      const minPartSizeMultiplePartChunk = part.slice(0, numOfMinPartSize * this.minPartSize);
      const lastPartChunk = part.slice(numOfMinPartSize * this.minPartSize);

      await this.uploadChunk(minPartSizeMultiplePartChunk);
      await this.uploadChunk(lastPartChunk, true);
    }
    else if (part.length < this.minPartSize) {
      await this.uploadChunk(part, true);
    }
  }

  async completeUpload(): Promise<void> {
    this.validateUploadStatus(UploadStatus.IN_PROGRESS);

    // Send a request to complete the upload, in case the last uploadPart request did not request completion.
    await axios.put(this.uploadId, {
      headers: {
        'Content-Range': `bytes */${this._uploadedFileSize}`,
      },
    });
    this.currentStatus = UploadStatus.COMPLETED;
    logger.info(`Multipart upload completed. Upload key: ${this.uploadKey}`);
  }

  async abortUpload(): Promise<void> {
    this.validateUploadStatus(UploadStatus.IN_PROGRESS);

    try {
      await axios.delete(this.uploadId);
    }
    catch (e) {
      if (e.response?.status !== 499) {
        throw e;
      }
    }
    this.currentStatus = UploadStatus.ABORTED;
    logger.info(`Multipart upload aborted. Upload key: ${this.uploadKey}`);
  }

  async getUploadedFileSize(): Promise<number> {
    if (this.currentStatus === UploadStatus.COMPLETED) {
      const [metadata] = await this.file.getMetadata();
      this._uploadedFileSize = metadata.size;
    }
    return this._uploadedFileSize;
  }

  private uploadChunk = async(chunk, isLastUpload = false) => {
    // If chunk size is larger than the minimal part size, it is required to be a multiple of the minimal part size
    // ref: https://cloud.google.com/storage/docs/performing-resumable-uploads?hl=en#chunked-upload
    if (chunk.length > this.minPartSize && chunk.length % this.minPartSize !== 0) throw Error(`chunk must be a multiple of ${this.minPartSize}`);

    const range = isLastUpload
      ? `bytes ${this._uploadedFileSize}-${this._uploadedFileSize + chunk.length - 1}/${this._uploadedFileSize + chunk.length}`
      : `bytes ${this._uploadedFileSize}-${this._uploadedFileSize + chunk.length - 1}/*`;

    try {
      await axios.put(this.uploadId, chunk, {
        headers: {
          'Content-Range': `${range}`,
        },
      });
    }
    catch (e) {
      if (e.response?.status !== 308) {
        throw e;
      }
    }
    this._uploadedFileSize += chunk.length;
  };

}
