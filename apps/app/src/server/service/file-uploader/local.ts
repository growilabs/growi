import type { ReadStream } from 'fs';
import { Readable } from 'stream';

import type { Response } from 'express';

import { ResponseMode, type RespondOptions } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';

import {
  AbstractFileUploader, type TemporaryUrl, type SaveFileParam,
} from './file-uploader';
import {
  ContentHeaders, applyHeaders,
} from './utils';


const logger = loggerFactory('growi:service:fileUploaderLocal');

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const mkdir = require('mkdirp');
const streamToPromise = require('stream-to-promise');
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
  override deleteFiles() {
    throw new Error('Method not implemented.');
  }

  deleteFileByFilePath(filePath: string): void {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override determineResponseMode() {
    return configManager.getConfig('crowi', 'fileUpload:local:useInternalRedirect')
      ? ResponseMode.DELEGATE
      : ResponseMode.RELAY;
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(readStream: ReadStream, attachment: IAttachmentDocument): Promise<void> {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override respond(res: Response, attachment: IAttachmentDocument, opts?: RespondOptions): void {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override findDeliveryFile(attachment: IAttachmentDocument): Promise<NodeJS.ReadableStream> {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritDoc
   */
  override async generateTemporaryUrl(attachment: IAttachmentDocument, opts?: RespondOptions): Promise<TemporaryUrl> {
    throw new Error('LocalFileUploader does not support ResponseMode.REDIRECT.');
  }

}

module.exports = function(crowi) {
  const lib = new LocalFileUploader(crowi);

  const basePath = path.posix.join(crowi.publicDir, 'uploads');

  function getFilePathOnStorage(attachment) {
    const dirName = (attachment.page != null)
      ? 'attachment'
      : 'user';
    const filePath = path.posix.join(basePath, dirName, attachment.fileName);

    return filePath;
  }

  async function readdirRecursively(dirPath) {
    const directories = await fsPromises.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(directories.map((directory) => {
      const childDirPathOrFilePath = path.resolve(dirPath, directory.name);
      return directory.isDirectory() ? readdirRecursively(childDirPathOrFilePath) : childDirPathOrFilePath;
    }));

    return files.flat();
  }

  lib.isValidUploadSettings = function() {
    return true;
  };

  (lib as any).deleteFile = async function(attachment) {
    const filePath = getFilePathOnStorage(attachment);
    return lib.deleteFileByFilePath(filePath);
  };

  (lib as any).deleteFiles = async function(attachments) {
    attachments.map((attachment) => {
      return (lib as any).deleteFile(attachment);
    });
  };

  lib.deleteFileByFilePath = async function(filePath) {
    // check file exists
    try {
      fs.statSync(filePath);
    }
    catch (err) {
      logger.warn(`Any AttachmentFile which path is '${filePath}' does not exist in local fs`);
      return;
    }

    return fs.unlinkSync(filePath);
  };

  lib.uploadAttachment = async function(fileStream, attachment) {
    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const filePath = getFilePathOnStorage(attachment);
    const dirpath = path.posix.dirname(filePath);

    // mkdir -p
    mkdir.sync(dirpath);

    const stream = fileStream.pipe(fs.createWriteStream(filePath));
    return streamToPromise(stream);
  };

  lib.saveFile = async function({ filePath, contentType, data }) {
    const absFilePath = path.posix.join(basePath, filePath);
    const dirpath = path.posix.dirname(absFilePath);

    // mkdir -p
    mkdir.sync(dirpath);

    const fileStream = new Readable();
    fileStream.push(data);
    fileStream.push(null); // EOF
    const stream = fileStream.pipe(fs.createWriteStream(absFilePath));
    return streamToPromise(stream);
  };

  /**
   * Find data substance
   *
   * @param {Attachment} attachment
   * @return {stream.Readable} readable stream
   */
  lib.findDeliveryFile = async function(attachment) {
    const filePath = getFilePathOnStorage(attachment);

    // check file exists
    try {
      fs.statSync(filePath);
    }
    catch (err) {
      throw new Error(`Any AttachmentFile that relate to the Attachment (${attachment._id.toString()}) does not exist in local fs`);
    }

    // return stream.Readable
    return fs.createReadStream(filePath);
  };

  /**
   * check the file size limit
   *
   * In detail, the followings are checked.
   * - per-file size limit (specified by MAX_FILE_SIZE)
   */
  (lib as any).checkLimit = async function(uploadFileSize) {
    const maxFileSize = configManager.getConfig('crowi', 'app:maxFileSize');
    const totalLimit = configManager.getConfig('crowi', 'app:fileUploadTotalLimit');
    return lib.doCheckLimit(uploadFileSize, maxFileSize, totalLimit);
  };

  /**
   * Respond to the HTTP request.
   * @param {Response} res
   * @param {Response} attachment
   */
  lib.respond = function(res, attachment, opts) {
    // Responce using internal redirect of nginx or Apache.
    const storagePath = getFilePathOnStorage(attachment);
    const relativePath = path.relative(crowi.publicDir, storagePath);
    const internalPathRoot = configManager.getConfig('crowi', 'fileUpload:local:internalRedirectPath');
    const internalPath = urljoin(internalPathRoot, relativePath);

    const isDownload = opts?.download ?? false;
    const contentHeaders = new ContentHeaders(attachment, { inline: !isDownload });
    applyHeaders(res, [
      ...contentHeaders.toExpressHttpHeaders(),
      { field: 'X-Accel-Redirect', value: internalPath },
      { field: 'X-Sendfile', value: storagePath },
    ]);

    return res.end();
  };

  /**
   * List files in storage
   */
  lib.listFiles = async function() {
    // `mkdir -p` to avoid ENOENT error
    await mkdir(basePath);
    const filePaths = await readdirRecursively(basePath);
    return Promise.all(
      filePaths.map(
        file => fsPromises.stat(file).then(({ size }) => ({
          name: path.relative(basePath, file),
          size,
        })),
      ),
    );
  };

  return lib;
};
