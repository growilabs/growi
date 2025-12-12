import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:services:fileUploader:multipartUploader');

export enum UploadStatus {
  BEFORE_INIT,
  IN_PROGRESS,
  COMPLETED,
  ABORTED,
}

export interface IMultipartUploader {
  initUpload(): Promise<void>;
  uploadPart(body: Buffer, partNumber: number): Promise<void>;
  completeUpload(): Promise<void>;
  abortUpload(): Promise<void>;
  uploadId: string;
  getUploadedFileSize(): Promise<number>;
}

/**
 * Abstract class for uploading files to cloud storage using multipart upload.
 * Each instance is equivalent to a single multipart upload, and cannot be reused once completed.
 */
export abstract class MultipartUploader implements IMultipartUploader {
  protected uploadKey: string;

  protected _uploadId: string | undefined;

  protected currentStatus: UploadStatus = UploadStatus.BEFORE_INIT;

  protected _uploadedFileSize = 0;

  protected readonly maxPartSize: number;

  constructor(uploadKey: string, maxPartSize: number) {
    this.maxPartSize = maxPartSize;
    this.uploadKey = uploadKey;
  }

  get uploadId(): string {
    if (this._uploadId == null) throw Error('UploadId is empty');
    return this._uploadId;
  }

  abstract initUpload(): Promise<void>;

  abstract uploadPart(part: Buffer, partNumber: number): Promise<void>;

  abstract completeUpload(): Promise<void>;

  abstract abortUpload(): Promise<void>;

  abstract getUploadedFileSize(): Promise<number>;

  protected validatePartSize(partSize: number): void {
    if (partSize > this.maxPartSize)
      throw Error(`partSize must be less than or equal to ${this.maxPartSize}`);
  }

  protected validateUploadStatus(desiredStatus: UploadStatus): void {
    if (desiredStatus === this.currentStatus) return;

    let errMsg: string | null = null;

    if (this.currentStatus === UploadStatus.COMPLETED) {
      errMsg = 'Multipart upload has already been completed';
    }

    if (this.currentStatus === UploadStatus.ABORTED) {
      errMsg = 'Multipart upload has been aborted';
    }

    if (this.currentStatus === UploadStatus.IN_PROGRESS) {
      if (desiredStatus === UploadStatus.BEFORE_INIT) {
        errMsg = 'Multipart upload is already in progress';
      } else {
        errMsg = 'Multipart upload is still in progress';
      }
    }

    if (this.currentStatus === UploadStatus.BEFORE_INIT) {
      errMsg = 'Multipart upload has not been initiated';
    }

    if (errMsg != null) {
      logger.error(errMsg);
      throw Error(errMsg);
    }
  }
}
