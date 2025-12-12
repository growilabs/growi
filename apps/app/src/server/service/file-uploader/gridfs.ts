import mongoose from 'mongoose';
import { createModel } from 'mongoose-gridfs';
import { Readable } from 'stream';
import util from 'util';

import type Crowi from '~/server/crowi';
import type { RespondOptions } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';
import {
  AbstractFileUploader,
  type SaveFileParam,
  type TemporaryUrl,
} from './file-uploader';
import { createContentHeaders, getContentHeaderValue } from './utils';

const logger = loggerFactory('growi:service:fileUploaderGridfs');

const COLLECTION_NAME = 'attachmentFiles';
const CHUNK_COLLECTION_NAME = `${COLLECTION_NAME}.chunks`;

type PromisifiedUtils = {
  read: (options?: object) => Readable;
  // eslint-disable-next-line @typescript-eslint/ban-types
  write: (file: object, stream: Readable, done?: Function) => void;
  // eslint-disable-next-line @typescript-eslint/ban-types
  unlink: (file: object, done?: Function) => void;
  promisifiedWrite: (file: object, readable: Readable) => Promise<any>;
  promisifiedUnlink: (file: object) => Promise<any>;
};

type AttachmentFileModel = mongoose.Model<any> & PromisifiedUtils;

// Cache holders to avoid repeated model creation and manage lifecycle
let cachedAttachmentFileModel: AttachmentFileModel;
let cachedChunkCollection: mongoose.Collection;
let cachedConnection: mongoose.Connection; // Track the connection instance itself

/**
 * Initialize GridFS models with connection instance monitoring
 * This prevents memory leaks from repeated model creation
 */
function initializeGridFSModels(): {
  attachmentFileModel: AttachmentFileModel;
  chunkCollection: mongoose.Collection;
} {
  // Check if we can reuse cached models by comparing connection instance
  if (
    cachedAttachmentFileModel != null &&
    cachedChunkCollection != null &&
    cachedConnection === mongoose.connection
  ) {
    return {
      attachmentFileModel: cachedAttachmentFileModel,
      chunkCollection: cachedChunkCollection,
    };
  }

  // Check connection state
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB connection is not ready for GridFS operations');
  }

  // Create new model instances
  const attachmentFileModel: AttachmentFileModel = createModel({
    modelName: COLLECTION_NAME,
    bucketName: COLLECTION_NAME,
    connection: mongoose.connection,
  });

  const chunkCollection = mongoose.connection.collection(CHUNK_COLLECTION_NAME);

  // Setup promisified methods on the model instance (not globally)
  if (!attachmentFileModel.promisifiedWrite) {
    attachmentFileModel.promisifiedWrite = util
      .promisify(attachmentFileModel.write)
      .bind(attachmentFileModel);
    attachmentFileModel.promisifiedUnlink = util
      .promisify(attachmentFileModel.unlink)
      .bind(attachmentFileModel);
  }

  // Cache the instances
  cachedAttachmentFileModel = attachmentFileModel;
  cachedChunkCollection = chunkCollection;
  cachedConnection = mongoose.connection;

  logger.debug('GridFS models initialized successfully');

  return { attachmentFileModel, chunkCollection };
}

// TODO: rewrite this module to be a type-safe implementation
class GridfsFileUploader extends AbstractFileUploader {
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
    const { attachmentFileModel } = initializeGridFSModels();
    const filenameValue = attachment.fileName;

    const attachmentFile = await attachmentFileModel.findOne({
      filename: filenameValue,
    });

    if (attachmentFile == null) {
      logger.warn(
        `Any AttachmentFile that relate to the Attachment (${attachment._id.toString()}) does not exist in GridFS`,
      );
      return;
    }

    return attachmentFileModel.promisifiedUnlink({ _id: attachmentFile._id });
  }

  /**
   * @inheritdoc
   *
   * Bulk delete files since unlink method of mongoose-gridfs does not support bulk operation
   */
  override async deleteFiles(
    attachments: IAttachmentDocument[],
  ): Promise<void> {
    const { attachmentFileModel, chunkCollection } = initializeGridFSModels();

    const filenameValues = attachments.map((attachment) => {
      return attachment.fileName;
    });
    const fileIdObjects = await attachmentFileModel.find(
      { filename: { $in: filenameValues } },
      { _id: 1 },
    );
    const idsRelatedFiles = fileIdObjects.map((obj) => {
      return obj._id;
    });

    await Promise.all([
      attachmentFileModel.deleteMany({ filename: { $in: filenameValues } }),
      chunkCollection.deleteMany({ files_id: { $in: idsRelatedFiles } }),
    ]);
  }

  /**
   * @inheritdoc
   *
   * Reference to previous implementation is
   * {@link https://github.com/growilabs/growi/blob/798e44f14ad01544c1d75ba83d4dfb321a94aa0b/src/server/service/file-uploader/gridfs.js#L86-L88}
   */
  override getFileUploadTotalLimit() {
    return (
      configManager.getConfig('gridfs:totalLimit') ??
      configManager.getConfig('app:fileUploadTotalLimit')
    );
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(
    readable: Readable,
    attachment: IAttachmentDocument,
  ): Promise<void> {
    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const { attachmentFileModel } = initializeGridFSModels();
    const contentHeaders = createContentHeaders(attachment);

    return attachmentFileModel.promisifiedWrite(
      {
        // put type and the file name for reference information when uploading
        filename: attachment.fileName,
        contentType: getContentHeaderValue(contentHeaders, 'Content-Type'),
      },
      readable,
    );
  }

  /**
   * @inheritdoc
   */
  override respond(): void {
    throw new Error(
      'GridfsFileUploader does not support ResponseMode.DELEGATE.',
    );
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
      'GridfsFileUploader does not support ResponseMode.REDIRECT.',
    );
  }
}

module.exports = (crowi: Crowi) => {
  const lib = new GridfsFileUploader(crowi);

  lib.isValidUploadSettings = () => true;

  lib.saveFile = async ({ filePath, contentType, data }) => {
    const { attachmentFileModel } = initializeGridFSModels();

    // Create a readable stream from the data
    const readable = new Readable({
      read() {
        this.push(data);
        this.push(null); // EOF
      },
    });

    try {
      // Add error handling to prevent resource leaks
      readable.on('error', (err) => {
        logger.error('Readable stream error:', err);
        readable.destroy();
        throw err;
      });

      // Use async/await for cleaner code
      const result = await attachmentFileModel.promisifiedWrite(
        {
          filename: filePath,
          contentType,
        },
        readable,
      );

      return result;
    } catch (error) {
      throw error;
    } finally {
      // Explicit cleanup to prevent memory leaks
      if (typeof readable.destroy === 'function') {
        readable.destroy();
      }
    }
  };

  /**
   * Find data substance
   *
   * @param {Attachment} attachment
   * @return {stream.Readable} readable stream
   */
  lib.findDeliveryFile = async (attachment) => {
    const { attachmentFileModel } = initializeGridFSModels();
    const filenameValue = attachment.fileName;

    const attachmentFile = await attachmentFileModel.findOne({
      filename: filenameValue,
    });

    if (attachmentFile == null) {
      throw new Error(
        `Any AttachmentFile that relate to the Attachment (${attachment._id.toString()}) does not exist in GridFS`,
      );
    }

    // return stream.Readable
    return attachmentFileModel.read({ _id: attachmentFile._id });
  };

  /**
   * List files in storage
   */
  (lib as any).listFiles = async () => {
    const { attachmentFileModel } = initializeGridFSModels();

    const attachmentFiles = await attachmentFileModel.find();
    return attachmentFiles.map(({ filename: name, length: size }) => ({
      name,
      size,
    }));
  };

  return lib;
};
