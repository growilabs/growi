import type { ReadStream } from 'fs';

import { Storage } from '@google-cloud/storage';
import urljoin from 'url-join';

import type Crowi from '~/server/crowi';
import { ResponseMode, type RespondOptions } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';

import {
  AbstractFileUploader, type TemporaryUrl, type SaveFileParam,
} from './file-uploader';
import { ContentHeaders } from './utils';

const logger = loggerFactory('growi:service:fileUploaderGcs');


function getGcsBucket() {
  return configManager.getConfig('crowi', 'gcs:bucket');
}

let storage: Storage;
function getGcsInstance() {
  if (storage == null) {
    const keyFilename = configManager.getConfig('crowi', 'gcs:apiKeyJsonPath');
    // see https://googleapis.dev/nodejs/storage/latest/Storage.html
    storage = keyFilename != null
      ? new Storage({ keyFilename }) // Create a client with explicit credentials
      : new Storage(); // Create a client that uses Application Default Credentials
  }
  return storage;
}

function getFilePathOnStorage(attachment) {
  const namespace = configManager.getConfig('crowi', 'gcs:uploadNamespace');
  // const namespace = null;
  const dirName = (attachment.page != null)
    ? 'attachment'
    : 'user';
  const filePath = urljoin(namespace || '', dirName, attachment.fileName);

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
    return configManager.getConfig('crowi', 'gcs:referenceFileWithRelayMode')
      ? ResponseMode.RELAY
      : ResponseMode.REDIRECT;
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(readStream: ReadStream, attachment: IAttachmentDocument): Promise<void> {
    if (!this.getIsUploadable()) {
      throw new Error('GCS is not configured.');
    }

    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const gcs = getGcsInstance();
    const myBucket = gcs.bucket(getGcsBucket());
    const filePath = getFilePathOnStorage(attachment);
    const contentHeaders = new ContentHeaders(attachment);

    await myBucket.upload(readStream.path.toString(), {
      destination: filePath,
      // put type and the file name for reference information when uploading
      contentType: contentHeaders.contentType?.value.toString(),
    });
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
      throw new Error(`Coudn't get file from AWS for the Attachment (${attachment._id.toString()})`);
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
    const lifetimeSecForTemporaryUrl = configManager.getConfig('crowi', 'gcs:lifetimeSecForTemporaryUrl');

    // issue signed url (default: expires 120 seconds)
    // https://cloud.google.com/storage/docs/access-control/signed-urls
    const isDownload = opts?.download ?? false;
    const contentHeaders = new ContentHeaders(attachment, { inline: !isDownload });
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + lifetimeSecForTemporaryUrl * 1000,
      responseType: contentHeaders.contentType?.value.toString(),
      responseDisposition: contentHeaders.contentDisposition?.value.toString(),
    });

    return {
      url: signedUrl,
      lifetimeSec: lifetimeSecForTemporaryUrl,
    };

  }

}


module.exports = function(crowi: Crowi) {
  const lib = new GcsFileUploader(crowi);

  lib.isValidUploadSettings = function() {
    return configManager.getConfig('crowi', 'gcs:apiKeyJsonPath') != null
      && configManager.getConfig('crowi', 'gcs:bucket') != null;
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
    const maxFileSize = configManager.getConfig('crowi', 'app:maxFileSize');
    const gcsTotalLimit = configManager.getConfig('crowi', 'app:fileUploadTotalLimit');
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
      prefix: configManager.getConfig('crowi', 'gcs:uploadNamespace'),
    });

    return files.map(({ name, metadata: { size } }) => {
      return { name, size };
    });
  };

  return lib;
};
