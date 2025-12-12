import type { Response } from 'express';
import type { Writable } from 'stream';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import type Crowi from '~/server/crowi';
import {
  FilePathOnStoragePrefix,
  type RespondOptions,
  ResponseMode,
} from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';
import {
  AbstractFileUploader,
  type SaveFileParam,
  type TemporaryUrl,
} from './file-uploader';
import {
  applyHeaders,
  createContentHeaders,
  toExpressHttpHeaders,
} from './utils';

const logger = loggerFactory('growi:service:fileUploaderLocal');

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const mkdir = require('mkdirp');
const urljoin = require('url-join');

// TODO: rewrite this module to be a type-safe implementation
class LocalFileUploader extends AbstractFileUploader {
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
  override async deleteFile(attachment: IAttachmentDocument): Promise<void> {
    const filePath = this.getFilePathOnStorage(attachment);
    return this.deleteFileByFilePath(filePath);
  }

  /**
   * @inheritdoc
   */
  override async deleteFiles(
    attachments: IAttachmentDocument[],
  ): Promise<void> {
    await Promise.all(
      attachments.map((attachment) => {
        return this.deleteFile(attachment);
      }),
    );
  }

  private async deleteFileByFilePath(filePath: string): Promise<void> {
    // check file exists
    try {
      fs.statSync(filePath);
    } catch (err) {
      logger.warn(
        `Any AttachmentFile which path is '${filePath}' does not exist in local fs`,
      );
      return;
    }

    return fs.unlinkSync(filePath);
  }

  getFilePathOnStorage(_attachment: IAttachmentDocument): string {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override determineResponseMode() {
    return configManager.getConfig('fileUpload:local:useInternalRedirect')
      ? ResponseMode.DELEGATE
      : ResponseMode.RELAY;
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(
    readable: Readable,
    attachment: IAttachmentDocument,
  ): Promise<void> {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override respond(
    res: Response,
    attachment: IAttachmentDocument,
    opts?: RespondOptions,
  ): void {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override findDeliveryFile(
    attachment: IAttachmentDocument,
  ): Promise<NodeJS.ReadableStream> {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritDoc
   */
  override async generateTemporaryUrl(
    attachment: IAttachmentDocument,
    opts?: RespondOptions,
  ): Promise<TemporaryUrl> {
    throw new Error(
      'LocalFileUploader does not support ResponseMode.REDIRECT.',
    );
  }
}

module.exports = (crowi: Crowi) => {
  const lib = new LocalFileUploader(crowi);

  const basePath = path.posix.join(crowi.publicDir, 'uploads');

  lib.getFilePathOnStorage = (attachment: IAttachmentDocument) => {
    const dirName =
      attachment.page != null
        ? FilePathOnStoragePrefix.attachment
        : FilePathOnStoragePrefix.user;
    const filePath = path.posix.join(basePath, dirName, attachment.fileName);

    return filePath;
  };

  async function readdirRecursively(dirPath) {
    const directories = await fsPromises.readdir(dirPath, {
      withFileTypes: true,
    });
    const files = await Promise.all(
      directories.map((directory) => {
        const childDirPathOrFilePath = path.resolve(dirPath, directory.name);
        return directory.isDirectory()
          ? readdirRecursively(childDirPathOrFilePath)
          : childDirPathOrFilePath;
      }),
    );

    return files.flat();
  }

  lib.isValidUploadSettings = () => true;

  lib.uploadAttachment = async (fileStream, attachment) => {
    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const filePath = lib.getFilePathOnStorage(attachment);
    const dirpath = path.posix.dirname(filePath);

    // mkdir -p
    mkdir.sync(dirpath);

    const writeStream: Writable = fs.createWriteStream(filePath);

    try {
      const uploadTimeout = configManager.getConfig('app:fileUploadTimeout');
      await pipeline(fileStream, writeStream, {
        signal: AbortSignal.timeout(uploadTimeout),
      });

      logger.debug(
        `File upload completed successfully: fileName=${attachment.fileName}`,
      );
    } catch (error) {
      // Handle timeout error specifically
      if (error.name === 'AbortError') {
        logger.warn(`Upload timeout: fileName=${attachment.fileName}`, error);
      } else {
        logger.error(
          `File upload failed: fileName=${attachment.fileName}`,
          error,
        );
      }
      // Re-throw the error to be handled by the caller.
      // The pipeline automatically handles stream cleanup on error.
      throw error;
    }
  };

  lib.saveFile = async ({ filePath, contentType, data }) => {
    const absFilePath = path.posix.join(basePath, filePath);
    const dirpath = path.posix.dirname(absFilePath);

    // mkdir -p
    mkdir.sync(dirpath);

    const fileStream = new Readable();
    fileStream.push(data);
    fileStream.push(null); // EOF
    const writeStream: Writable = fs.createWriteStream(absFilePath);
    return pipeline(fileStream, writeStream);
  };

  /**
   * Find data substance
   *
   * @param {Attachment} attachment
   * @return {stream.Readable} readable stream
   */
  lib.findDeliveryFile = async (attachment) => {
    const filePath = lib.getFilePathOnStorage(attachment);

    // check file exists
    try {
      fs.statSync(filePath);
    } catch (err) {
      throw new Error(
        `Any AttachmentFile that relate to the Attachment (${attachment._id.toString()}) does not exist in local fs`,
      );
    }

    // return stream.Readable
    return fs.createReadStream(filePath);
  };

  /**
   * Respond to the HTTP request.
   * @param {Response} res
   * @param {Response} attachment
   */
  lib.respond = (res, attachment, opts) => {
    // Responce using internal redirect of nginx or Apache.
    const storagePath = lib.getFilePathOnStorage(attachment);
    const relativePath = path.relative(crowi.publicDir, storagePath);
    const internalPathRoot = configManager.getConfig(
      'fileUpload:local:internalRedirectPath',
    );
    const internalPath = urljoin(internalPathRoot, relativePath);

    const isDownload = opts?.download ?? false;
    const contentHeaders = createContentHeaders(attachment, {
      inline: !isDownload,
    });
    applyHeaders(res, [
      ...toExpressHttpHeaders(contentHeaders),
      { field: 'X-Accel-Redirect', value: internalPath },
      { field: 'X-Sendfile', value: storagePath },
    ]);

    return res.end();
  };

  /**
   * List files in storage
   */
  lib.listFiles = async () => {
    // `mkdir -p` to avoid ENOENT error
    await mkdir(basePath);
    const filePaths = await readdirRecursively(basePath);
    return Promise.all(
      filePaths.map((file) =>
        fsPromises.stat(file).then(({ size }) => ({
          name: path.relative(basePath, file),
          size,
        })),
      ),
    );
  };

  return lib;
};
