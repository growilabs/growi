import { Readable } from 'stream';
import util from 'util';

import mongoose from 'mongoose';
import { createModel } from 'mongoose-gridfs';

import type Crowi from '~/server/crowi';
import type { RespondOptions } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';

import { AbstractFileUploader, type TemporaryUrl, type SaveFileParam } from './file-uploader';
import { ContentHeaders } from './utils';

const logger = loggerFactory('growi:service:fileUploaderGridfs');


const COLLECTION_NAME = 'attachmentFiles';
const CHUNK_COLLECTION_NAME = `${COLLECTION_NAME}.chunks`;

// instantiate mongoose-gridfs
const AttachmentFile = createModel({
  modelName: COLLECTION_NAME,
  bucketName: COLLECTION_NAME,
  connection: mongoose.connection,
});


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
  override deleteFiles() {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(readable: Readable, attachment: IAttachmentDocument): Promise<void> {
    logger.debug(`File uploading: fileName=${attachment.fileName}`);

    const contentHeaders = new ContentHeaders(attachment);

    return AttachmentFile.promisifiedWrite(
      {
        // put type and the file name for reference information when uploading
        filename: attachment.fileName,
        contentType: contentHeaders.contentType?.value.toString(),
      },
      readable,
    );
  }

  /**
   * @inheritdoc
   */
  override respond(): void {
    throw new Error('GridfsFileUploader does not support ResponseMode.DELEGATE.');
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
    throw new Error('GridfsFileUploader does not support ResponseMode.REDIRECT.');
  }

}


module.exports = function(crowi: Crowi) {
  const lib = new GridfsFileUploader(crowi);

  // get Collection instance of chunk
  const chunkCollection = mongoose.connection.collection(CHUNK_COLLECTION_NAME);

  // create promisified method
  AttachmentFile.promisifiedWrite = util.promisify(AttachmentFile.write).bind(AttachmentFile);
  AttachmentFile.promisifiedUnlink = util.promisify(AttachmentFile.unlink).bind(AttachmentFile);

  lib.isValidUploadSettings = function() {
    return true;
  };

  (lib as any).deleteFile = async function(attachment) {
    const filenameValue = attachment.fileName;

    const attachmentFile = await AttachmentFile.findOne({ filename: filenameValue });

    if (attachmentFile == null) {
      logger.warn(`Any AttachmentFile that relate to the Attachment (${attachment._id.toString()}) does not exist in GridFS`);
      return;
    }
    return AttachmentFile.promisifiedUnlink({ _id: attachmentFile._id });
  };

  (lib as any).deleteFiles = async function(attachments) {
    const filenameValues = attachments.map((attachment) => {
      return attachment.fileName;
    });
    const fileIdObjects = await AttachmentFile.find({ filename: { $in: filenameValues } }, { _id: 1 });
    const idsRelatedFiles = fileIdObjects.map((obj) => { return obj._id });

    return Promise.all([
      AttachmentFile.deleteMany({ filename: { $in: filenameValues } }),
      chunkCollection.deleteMany({ files_id: { $in: idsRelatedFiles } }),
    ]);
  };

  /**
   * get size of data uploaded files using (Promise wrapper)
   */
  // const getCollectionSize = () => {
  //   return new Promise((resolve, reject) => {
  //     chunkCollection.stats((err, data) => {
  //       if (err) {
  //         // return 0 if not exist
  //         if (err.errmsg.includes('not found')) {
  //           return resolve(0);
  //         }
  //         return reject(err);
  //       }
  //       return resolve(data.size);
  //     });
  //   });
  // };

  /**
   * check the file size limit
   *
   * In detail, the followings are checked.
   * - per-file size limit (specified by MAX_FILE_SIZE)
   * - mongodb(gridfs) size limit (specified by MONGO_GRIDFS_TOTAL_LIMIT)
   */
  (lib as any).checkLimit = async function(uploadFileSize) {
    const maxFileSize = configManager.getConfig('app:maxFileSize');
    const totalLimit = lib.getFileUploadTotalLimit();
    return lib.doCheckLimit(uploadFileSize, maxFileSize, totalLimit);
  };

  lib.saveFile = async function({ filePath, contentType, data }) {
    const readable = new Readable();
    readable.push(data);
    readable.push(null); // EOF

    return AttachmentFile.promisifiedWrite(
      {
        filename: filePath,
        contentType,
      },
      readable,
    );
  };

  /**
   * Find data substance
   *
   * @param {Attachment} attachment
   * @return {stream.Readable} readable stream
   */
  lib.findDeliveryFile = async function(attachment) {
    const filenameValue = attachment.fileName;

    const attachmentFile = await AttachmentFile.findOne({ filename: filenameValue });

    if (attachmentFile == null) {
      throw new Error(`Any AttachmentFile that relate to the Attachment (${attachment._id.toString()}) does not exist in GridFS`);
    }

    // return stream.Readable
    return AttachmentFile.read({ _id: attachmentFile._id });
  };

  /**
   * List files in storage
   */
  (lib as any).listFiles = async function() {
    const attachmentFiles = await AttachmentFile.find();
    return attachmentFiles.map(({ filename: name, length: size }) => ({
      name, size,
    }));
  };

  return lib;
};
