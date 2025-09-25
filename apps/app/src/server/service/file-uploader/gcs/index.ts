import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { Storage } from '@google-cloud/storage';
import { toNonBlankStringOrUndefined } from '@growi/core/dist/interfaces';
import axios from 'axios';
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
import { createContentHeaders, getContentHeaderValue } from '../utils';

import { GcsMultipartUploader } from './multipart-uploader';

const logger = loggerFactory('growi:service:fileUploaderGcs');


function getGcsBucket(): string {
  const gcsBucket = toNonBlankStringOrUndefined(configManager.getConfig('gcs:bucket')); // Blank strings may remain in the DB, so convert with toNonBlankStringOrUndefined for safety
  if (gcsBucket == null) {
    throw new Error('GCS bucket is not configured.');
  }
  return gcsBucket;
}

let storage: Storage;
function getGcsInstance() {
  if (storage == null) {
    const keyFilename = toNonBlankStringOrUndefined(configManager.getConfig('gcs:apiKeyJsonPath')); // Blank strings may remain in the DB, so convert with toNonBlankStringOrUndefined for safety
    // see https://googleapis.dev/nodejs/storage/latest/Storage.html
    storage = keyFilename != null
      ? new Storage({ keyFilename }) // Create a client with explicit credentials
      : new Storage(); // Create a client that uses Application Default Credentials
  }
  return storage;
}

function getFilePathOnStorage(attachment: IAttachmentDocument) {
  const namespace = configManager.getConfig('gcs:uploadNamespace');
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
  const filePath = urljoin(namespace, dirName, attachment.fileName);

  return filePath;
}

/**
 * check file existence
 * @param {File} file https://googleapis.dev/nodejs/storage/latest/File.html
 */
async function isFileExists(file) {
  // check file exists
  const res = await file.exists();
  return res[0];
}

// TODO: rewrite this module to be a type-safe implementation
class GcsFileUploader extends AbstractFileUploader {

  /**
   * @inheritdoc
   */
  override isValidUploadSettings(): boolean {
    try {
      getGcsBucket();
      return true;
    }
    catch (err) {
      logger.error(err);
      return false;
    }
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
    return configManager.getConfig('gcs:referenceFileWithRelayMode')
      ? ResponseMode.RELAY
      : ResponseMode.REDIRECT;
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(readable: Readable, attachment: IAttachmentDocument): Promise<void> {
    if (!this.getIsUploadable()) {
      throw new Error('GCS is not configured.');
    }

    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const gcs = getGcsInstance();
    const myBucket = gcs.bucket(getGcsBucket());
    const filePath = getFilePathOnStorage(attachment);
    const contentHeaders = createContentHeaders(attachment);

    const file = myBucket.file(filePath);
    const writeStream = file.createWriteStream({
      // put type and the file name for reference information when uploading
      contentType: getContentHeaderValue(contentHeaders, 'Content-Type'),
    });

    try {
      const uploadTimeout = configManager.getConfig('app:fileUploadTimeout');

      // Use AbortSignal.timeout() for robust timeout handling (Node.js 16+)
      await pipeline(
        readable,
        writeStream,
        { signal: AbortSignal.timeout(uploadTimeout) },
      );

      logger.debug(`File upload completed successfully: fileName=${attachment.fileName}`);
    }
    catch (error) {
      // Handle timeout error specifically
      if (error.name === 'AbortError') {
        logger.warn(`Upload timeout: fileName=${attachment.fileName}`, error);
      }
      else {
        logger.error(`File upload failed: fileName=${attachment.fileName}`, error);
      }
      // Re-throw the error to be handled by the caller.
      // The pipeline automatically handles stream cleanup on error.
      throw error;
    }
  }

  /**
   * @inheritdoc
   */
  override respond(): void {
    throw new Error('GcsFileUploader does not support ResponseMode.DELEGATE.');
  }

  /**
   * @inheritdoc
   */
  override async findDeliveryFile(attachment: IAttachmentDocument): Promise<NodeJS.ReadableStream> {
    if (!this.getIsReadable()) {
      throw new Error('GCS is not configured.');
    }

    const gcs = getGcsInstance();
    const myBucket = gcs.bucket(getGcsBucket());
    const filePath = getFilePathOnStorage(attachment);
    const file = myBucket.file(filePath);

    // check file exists
    const isExists = await isFileExists(file);
    if (!isExists) {
      throw new Error(`Any object that relate to the Attachment (${filePath}) does not exist in GCS`);
    }

    try {
      return file.createReadStream();
    }
    catch (err) {
      logger.error(err);
      throw new Error(`Coudn't get file from GCS for the Attachment (${attachment._id.toString()})`);
    }
  }

  /**
   * @inheritDoc
   */
  override async generateTemporaryUrl(attachment: IAttachmentDocument, opts?: RespondOptions): Promise<TemporaryUrl> {
    if (!this.getIsUploadable()) {
      throw new Error('GCS is not configured.');
    }

    const gcs = getGcsInstance();
    const myBucket = gcs.bucket(getGcsBucket());
    const filePath = getFilePathOnStorage(attachment);
    const file = myBucket.file(filePath);
    const lifetimeSecForTemporaryUrl = configManager.getConfig('gcs:lifetimeSecForTemporaryUrl');

    // issue signed url (default: expires 120 seconds)
    // https://cloud.google.com/storage/docs/access-control/signed-urls
    const isDownload = opts?.download ?? false;
    const contentHeaders = createContentHeaders(attachment, { inline: !isDownload });
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + lifetimeSecForTemporaryUrl * 1000,
      responseType: getContentHeaderValue(contentHeaders, 'Content-Type'),
      responseDisposition: getContentHeaderValue(contentHeaders, 'Content-Disposition'),
    });

    return {
      url: signedUrl,
      lifetimeSec: lifetimeSecForTemporaryUrl,
    };

  }

  override createMultipartUploader(uploadKey: string, maxPartSize: number) {
    const gcs = getGcsInstance();
    const myBucket = gcs.bucket(getGcsBucket());
    return new GcsMultipartUploader(myBucket, uploadKey, maxPartSize);
  }

  override async abortPreviousMultipartUpload(uploadKey: string, uploadId: string) {
    try {
      await axios.delete(uploadId);
    }
    catch (e) {
      // allow 404: allow duplicate abort requests to ensure abortion
      // allow 499: it is the success response code for canceling upload
      // ref: https://cloud.google.com/storage/docs/performing-resumable-uploads#cancel-upload
      if (e.response?.status !== 404 && e.response?.status !== 499) {
        throw e;
      }
    }
  }

}


module.exports = function(crowi: Crowi) {
  const lib = new GcsFileUploader(crowi);

  lib.isValidUploadSettings = function() {
    return configManager.getConfig('gcs:apiKeyJsonPath') != null
      && configManager.getConfig('gcs:bucket') != null;
  };

  (lib as any).deleteFile = function(attachment) {
    const filePath = getFilePathOnStorage(attachment);
    return (lib as any).deleteFilesByFilePaths([filePath]);
  };

  (lib as any).deleteFiles = function(attachments) {
    const filePaths = attachments.map((attachment) => {
      return getFilePathOnStorage(attachment);
    });
    return (lib as any).deleteFilesByFilePaths(filePaths);
  };

  (lib as any).deleteFilesByFilePaths = function(filePaths) {
    if (!lib.getIsUploadable()) {
      throw new Error('GCS is not configured.');
    }

    const gcs = getGcsInstance();
    const myBucket = gcs.bucket(getGcsBucket());

    const files = filePaths.map((filePath) => {
      return myBucket.file(filePath);
    });

    files.forEach((file) => {
      file.delete({ ignoreNotFound: true });
    });
  };

  lib.saveFile = async function({ filePath, contentType, data }) {
    const gcs = getGcsInstance();
    const myBucket = gcs.bucket(getGcsBucket());

    return myBucket.file(filePath).save(data, { resumable: false });
  };

  /**
   * check the file size limit
   *
   * In detail, the followings are checked.
   * - per-file size limit (specified by MAX_FILE_SIZE)
   */
  (lib as any).checkLimit = async function(uploadFileSize) {
    const maxFileSize = configManager.getConfig('app:maxFileSize');
    const gcsTotalLimit = configManager.getConfig('app:fileUploadTotalLimit');
    return lib.doCheckLimit(uploadFileSize, maxFileSize, gcsTotalLimit);
  };

  /**
   * List files in storage
   */
  (lib as any).listFiles = async function() {
    if (!lib.getIsReadable()) {
      throw new Error('GCS is not configured.');
    }

    const gcs = getGcsInstance();
    const bucket = gcs.bucket(getGcsBucket());
    const [files] = await bucket.getFiles({
      prefix: configManager.getConfig('gcs:uploadNamespace'),
    });

    return files.map(({ name, metadata: { size } }) => {
      return { name, size };
    });
  };

  return lib;
};
