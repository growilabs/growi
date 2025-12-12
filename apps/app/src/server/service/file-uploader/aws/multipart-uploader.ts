import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  type S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

import loggerFactory from '~/utils/logger';

import {
  type IMultipartUploader,
  MultipartUploader,
  UploadStatus,
} from '../multipart-uploader';

const logger = loggerFactory(
  'growi:services:fileUploaderAws:multipartUploader',
);

export type IAwsMultipartUploader = IMultipartUploader;

export class AwsMultipartUploader
  extends MultipartUploader
  implements IAwsMultipartUploader
{
  private bucket: string | undefined;

  private s3Client: S3Client;

  private parts: { PartNumber: number; ETag: string | undefined }[] = [];

  constructor(
    s3Client: S3Client,
    bucket: string | undefined,
    uploadKey: string,
    maxPartSize: number,
  ) {
    super(uploadKey, maxPartSize);

    this.s3Client = s3Client;
    this.bucket = bucket;
    this.uploadKey = uploadKey;
  }

  async initUpload(): Promise<void> {
    this.validateUploadStatus(UploadStatus.BEFORE_INIT);

    const response = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.uploadKey,
      }),
    );
    if (response.UploadId == null) {
      throw Error('UploadId is empty');
    }
    this._uploadId = response.UploadId;
    this.currentStatus = UploadStatus.IN_PROGRESS;
    logger.info(`Multipart upload initialized. Upload key: ${this.uploadKey}`);
  }

  async uploadPart(part: Buffer, partNumber: number): Promise<void> {
    this.validateUploadStatus(UploadStatus.IN_PROGRESS);
    this.validatePartSize(part.length);

    const uploadMetaData = await this.s3Client.send(
      new UploadPartCommand({
        Body: part,
        Bucket: this.bucket,
        Key: this.uploadKey,
        PartNumber: partNumber,
        UploadId: this.uploadId,
      }),
    );

    this.parts.push({
      PartNumber: partNumber,
      ETag: uploadMetaData.ETag,
    });
    this._uploadedFileSize += part.length;
  }

  async completeUpload(): Promise<void> {
    this.validateUploadStatus(UploadStatus.IN_PROGRESS);

    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.uploadKey,
        UploadId: this.uploadId,
        MultipartUpload: {
          Parts: this.parts,
        },
      }),
    );
    this.currentStatus = UploadStatus.COMPLETED;
    logger.info(`Multipart upload completed. Upload key: ${this.uploadKey}`);
  }

  async abortUpload(): Promise<void> {
    this.validateUploadStatus(UploadStatus.IN_PROGRESS);

    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.uploadKey,
        UploadId: this.uploadId,
      }),
    );
    this.currentStatus = UploadStatus.ABORTED;
    logger.info(`Multipart upload aborted. Upload key: ${this.uploadKey}`);
  }

  async getUploadedFileSize(): Promise<number> {
    if (this.currentStatus === UploadStatus.COMPLETED) {
      const headData = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.uploadKey,
        }),
      );
      if (headData.ContentLength == null)
        throw Error('Could not fetch uploaded file size');
      this._uploadedFileSize = headData.ContentLength;
    }
    return this._uploadedFileSize;
  }
}
