import type { Readable } from 'stream';

import type { GetObjectCommandInput, HeadObjectCommandInput } from '@aws-sdk/client-s3';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsCommand,
  ObjectCannedACL,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { NonBlankString } from '@growi/core/dist/interfaces';
import { toNonBlankStringOrUndefined } from '@growi/core/dist/interfaces';
import urljoin from 'url-join';

import type Crowi from '~/server/crowi';
import {
  AttachmentType, FilePathOnStoragePrefix, ResponseMode, type RespondOptions,
} from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../../config-manager';
import {
  AbstractFileUploader, type TemporaryUrl, type SaveFileParam,
} from '../file-uploader';
import { ContentHeaders } from '../utils';

import { AwsMultipartUploader } from './multipart-uploader';


const logger = loggerFactory('growi:service:fileUploaderAws');

/**
 * File metadata in storage
 * TODO: mv this to "./uploader"
 */
interface FileMeta {
  name: string;
  size: number;
}

const isFileExists = async(s3: S3Client, params: HeadObjectCommandInput) => {
  try {
    await s3.send(new HeadObjectCommand(params));
  }
  catch (err) {
    if (err != null && err.code === 'NotFound') {
      return false;
    }
    throw err;
  }
  return true;
};

const ObjectCannedACLs = [
  ObjectCannedACL.authenticated_read,
  ObjectCannedACL.aws_exec_read,
  ObjectCannedACL.bucket_owner_full_control,
  ObjectCannedACL.bucket_owner_read,
  ObjectCannedACL.private,
  ObjectCannedACL.public_read,
  ObjectCannedACL.public_read_write,
];
const isValidObjectCannedACL = (acl: string | undefined): acl is ObjectCannedACL => {
  return ObjectCannedACLs.includes(acl as ObjectCannedACL);
};
/**
 * @see: https://dev.growi.org/5d091f611fe336003eec5bfd
 * @returns ObjectCannedACL
 */
const getS3PutObjectCannedAcl = (): ObjectCannedACL | undefined => {
  const s3ObjectCannedACL = configManager.getConfig('aws:s3ObjectCannedACL');
  if (isValidObjectCannedACL(s3ObjectCannedACL)) {
    return s3ObjectCannedACL;
  }
  return undefined;
};

const getS3Bucket = (): NonBlankString | undefined => {
  return toNonBlankStringOrUndefined(configManager.getConfig('aws:s3Bucket')); // Blank strings may remain in the DB, so convert with toNonBlankStringOrUndefined for safety
};

// Singleton S3Client to prevent memory leaks from multiple client instances
let s3ClientInstance: S3Client | null = null;

const getS3Client = (): S3Client => {
  if (s3ClientInstance == null) {
    const accessKeyId = configManager.getConfig('aws:s3AccessKeyId');
    const secretAccessKey = configManager.getConfig('aws:s3SecretAccessKey');
    const s3Region = toNonBlankStringOrUndefined(configManager.getConfig('aws:s3Region')); // Blank strings may remain in the DB, so convert with toNonBlankStringOrUndefined for safety
    const s3CustomEndpoint = toNonBlankStringOrUndefined(configManager.getConfig('aws:s3CustomEndpoint'));

    s3ClientInstance = new S3Client({
      credentials: accessKeyId != null && secretAccessKey != null
        ? {
          accessKeyId,
          secretAccessKey,
        }
        : undefined,
      region: s3Region,
      endpoint: s3CustomEndpoint,
      forcePathStyle: s3CustomEndpoint != null, // s3ForcePathStyle renamed to forcePathStyle in v3
    });
  }
  return s3ClientInstance;
};

// Cleanup function for application shutdown
const cleanupS3Client = async (): Promise<void> => {
  if (s3ClientInstance != null) {
    try {
      await s3ClientInstance.destroy();
    }
    catch (err) {
      logger.warn('Error during S3Client cleanup:', err);
    }
    finally {
      s3ClientInstance = null;
    }
  }
};

// Deprecated: Use getS3Client() instead
const S3Factory = (): S3Client => {
  logger.warn('S3Factory is deprecated. Use getS3Client() instead.');
  return getS3Client();
};

const getFilePathOnStorage = (attachment: IAttachmentDocument) => {
  if (attachment.filePath != null) { // DEPRECATED: remains for backward compatibility for v3.3.x or below
    return attachment.filePath;
  }

  let dirName: string;
  if (attachment.attachmentType === AttachmentType.PAGE_BULK_EXPORT) {
    dirName = FilePathOnStoragePrefix.pageBulkExport;
  }
  else if (attachment.page != null) {
    dirName = FilePathOnStoragePrefix.attachment;
  }
  else {
    dirName = FilePathOnStoragePrefix.user;
  }
  const filePath = urljoin(dirName, attachment.fileName);

  return filePath;
};

// TODO: rewrite this module to be a type-safe implementation
class AwsFileUploader extends AbstractFileUploader {

  /**
   * @inheritdoc
   */
  override isValidUploadSettings(): boolean {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override listFiles() {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override saveFile(param: SaveFileParam) {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override deleteFiles() {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override determineResponseMode() {
    return configManager.getConfig('aws:referenceFileWithRelayMode')
      ? ResponseMode.RELAY
      : ResponseMode.REDIRECT;
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(readable: Readable, attachment: IAttachmentDocument): Promise<void> {
    if (!this.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }

    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const s3 = getS3Client(); // Use singleton S3Client

    const filePath = getFilePathOnStorage(attachment);
    const contentHeaders = new ContentHeaders(attachment);

    await s3.send(new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: filePath,
      Body: readable,
      ACL: getS3PutObjectCannedAcl(),
      // put type and the file name for reference information when uploading
      ContentType: contentHeaders.contentType?.value.toString(),
      ContentDisposition: contentHeaders.contentDisposition?.value.toString(),
    }));
  }

  /**
   * @inheritdoc
   */
  override respond(): void {
    throw new Error('AwsFileUploader does not support ResponseMode.DELEGATE.');
  }

  /**
   * @inheritdoc
   */
  override async findDeliveryFile(attachment: IAttachmentDocument): Promise<NodeJS.ReadableStream> {
    if (!this.getIsReadable()) {
      throw new Error('AWS is not configured.');
    }

    const s3 = getS3Client(); // Use singleton S3Client
    const filePath = getFilePathOnStorage(attachment);

    const params = {
      Bucket: getS3Bucket(),
      Key: filePath,
    };

    // check file exists
    const isExists = await isFileExists(s3, params);
    if (!isExists) {
      throw new Error(`Any object that relate to the Attachment (${filePath}) does not exist in AWS S3`);
    }

    try {
      const response = await s3.send(new GetObjectCommand(params));
      const body = response.Body;

      if (body == null) {
        throw new Error(`S3 returned null for the Attachment (${filePath})`);
      }

      // eslint-disable-next-line no-nested-ternary
      const stream = 'stream' in body
        ? body.stream() as unknown as NodeJS.ReadableStream // get stream from Blob and cast force
        : body as unknown as NodeJS.ReadableStream; // cast force

      // Add error handling for stream to prevent memory leaks
      stream.on('error', (err) => {
        logger.error('Stream error for attachment:', attachment._id.toString(), err);
        try {
          // Check if stream has destroy method (Node.js streams)
          if ('destroy' in stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
        }
        catch (destroyErr) {
          logger.warn('Error destroying stream:', destroyErr);
        }
      });

      return stream;
    }
    catch (err) {
      logger.error(err);
      throw new Error(`Coudn't get file from AWS for the Attachment (${attachment._id.toString()})`);
    }
  }

  /**
   * @inheritDoc
   */
  override async generateTemporaryUrl(attachment: IAttachmentDocument, opts?: RespondOptions): Promise<TemporaryUrl> {
    if (!this.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }

    const s3 = getS3Client(); // Use singleton S3Client
    const filePath = getFilePathOnStorage(attachment);
    const lifetimeSecForTemporaryUrl = configManager.getConfig('aws:lifetimeSecForTemporaryUrl');

    // issue signed url (default: expires 120 seconds)
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getSignedUrl-property
    const isDownload = opts?.download ?? false;
    const contentHeaders = new ContentHeaders(attachment, { inline: !isDownload });
    const params: GetObjectCommandInput = {
      Bucket: getS3Bucket(),
      Key: filePath,
      ResponseContentType: contentHeaders.contentType?.value.toString(),
      ResponseContentDisposition: contentHeaders.contentDisposition?.value.toString(),
    };
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand(params), {
      expiresIn: lifetimeSecForTemporaryUrl,
    });

    return {
      url: signedUrl,
      lifetimeSec: lifetimeSecForTemporaryUrl,
    };

  }

  override createMultipartUploader(uploadKey: string, maxPartSize: number) {
    const s3 = getS3Client(); // Use singleton S3Client
    return new AwsMultipartUploader(s3, getS3Bucket(), uploadKey, maxPartSize);
  }

  override async abortPreviousMultipartUpload(uploadKey: string, uploadId: string) {
    const s3 = getS3Client(); // Use singleton S3Client
    try {
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: getS3Bucket(),
        Key: uploadKey,
        UploadId: uploadId,
      }));
    }
    catch (e) {
      // allow duplicate abort requests to ensure abortion
      if (e.response?.status !== 404) {
        throw e;
      }
    }
  }

}

module.exports = (crowi: Crowi) => {
  const lib = new AwsFileUploader(crowi);

  lib.isValidUploadSettings = function() {
    return configManager.getConfig('aws:s3AccessKeyId') != null
      && configManager.getConfig('aws:s3SecretAccessKey') != null
      && (
        configManager.getConfig('aws:s3Region') != null
          || configManager.getConfig('aws:s3CustomEndpoint') != null
      )
      && configManager.getConfig('aws:s3Bucket') != null;
  };

  (lib as any).deleteFile = async function(attachment) {
    const filePath = getFilePathOnStorage(attachment);
    return (lib as any).deleteFileByFilePath(filePath);
  };

  (lib as any).deleteFiles = async function(attachments) {
    if (!lib.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }
    const s3 = getS3Client(); // Use singleton S3Client

    const filePaths = attachments.map((attachment) => {
      return { Key: getFilePathOnStorage(attachment) };
    });

    const totalParams = {
      Bucket: getS3Bucket(),
      Delete: { Objects: filePaths },
    };
    return s3.send(new DeleteObjectsCommand(totalParams));
  };

  (lib as any).deleteFileByFilePath = async function(filePath) {
    if (!lib.getIsUploadable()) {
      throw new Error('AWS is not configured.');
    }
    const s3 = getS3Client(); // Use singleton S3Client

    const params = {
      Bucket: getS3Bucket(),
      Key: filePath,
    };

    // check file exists
    const isExists = await isFileExists(s3, params);
    if (!isExists) {
      logger.warn(`Any object that relate to the Attachment (${filePath}) does not exist in AWS S3`);
      return;
    }

    return s3.send(new DeleteObjectCommand(params));
  };

  lib.saveFile = async function({ filePath, contentType, data }) {
    const s3 = getS3Client(); // Use singleton S3Client

    return s3.send(new PutObjectCommand({
      Bucket: getS3Bucket(),
      ContentType: contentType,
      Key: filePath,
      Body: data,
      ACL: getS3PutObjectCannedAcl(),
    }));
  };

  (lib as any).checkLimit = async function(uploadFileSize) {
    const maxFileSize = configManager.getConfig('app:maxFileSize');
    const totalLimit = configManager.getConfig('app:fileUploadTotalLimit');
    return lib.doCheckLimit(uploadFileSize, maxFileSize, totalLimit);
  };

  /**
   * List files in storage with memory-efficient pagination
   * Returns an async generator to prevent memory leaks with large file lists
   */
  (lib as any).listFiles = async function* () {
    if (!lib.getIsReadable()) {
      throw new Error('AWS is not configured.');
    }

    const s3 = getS3Client(); // Use singleton S3Client
    const BATCH_SIZE = 1000; // Limit batch size to prevent memory issues
    let nextMarker: string | undefined;
    let shouldContinue = true;
    let totalProcessed = 0;
    const MAX_TOTAL_FILES = 100000; // Safety limit to prevent runaway processes

    // handle pagination with memory efficiency
    while (shouldContinue && totalProcessed < MAX_TOTAL_FILES) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { Contents = [], IsTruncated, NextMarker } = await s3.send(new ListObjectsCommand({
          Bucket: getS3Bucket(),
          Marker: nextMarker,
          MaxKeys: BATCH_SIZE, // Limit each S3 request
        }));

        // Process files in batches to reduce memory usage
        const batchFiles = Contents.map(({ Key, Size }) => ({
          name: Key as string,
          size: Size as number,
        }));

        // Yield batch instead of accumulating all files
        yield batchFiles;
        
        totalProcessed += batchFiles.length;

        if (!IsTruncated) {
          shouldContinue = false;
          nextMarker = undefined;
        }
        else {
          nextMarker = NextMarker;
        }

        // Log progress for large operations
        if (totalProcessed % 10000 === 0) {
          logger.debug(`Processed ${totalProcessed} files, continuing...`);
        }
      }
      catch (error) {
        logger.error('Error during file listing:', error);
        throw error;
      }
    }

    if (totalProcessed >= MAX_TOTAL_FILES) {
      logger.warn(`File listing stopped at ${MAX_TOTAL_FILES} files to prevent memory issues`);
    }

    logger.debug(`File listing completed. Total processed: ${totalProcessed} files`);
  };

  // Backward compatibility: Convert generator to array for existing code
  (lib as any).listFilesLegacy = async function() {
    const allFiles: FileMeta[] = [];
    
    // Use the generator but accumulate results for backward compatibility
    for await (const batch of (lib as any).listFiles()) {
      allFiles.push(...batch);
      
      // Safety check to prevent excessive memory usage
      if (allFiles.length > 50000) {
        logger.warn(`Legacy listFiles stopped at ${allFiles.length} files to prevent memory issues. Use listFiles() generator for large datasets.`);
        break;
      }
    }
    
    return allFiles;
  };

  // Add cleanup method for application shutdown
  (lib as any).cleanup = cleanupS3Client;

  return lib;
};
