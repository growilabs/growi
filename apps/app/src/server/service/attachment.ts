import type { IAttachment, Ref } from '@growi/core/dist/interfaces';
import type { HydratedDocument } from 'mongoose';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { AttachmentType } from '../interfaces/attachment';
import type { IAttachmentDocument } from '../models/attachment';
import { Attachment } from '../models/attachment';

const fs = require('fs');

const mongoose = require('mongoose');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:service:AttachmentService');

const createReadStream = (filePath) => {
  return fs.createReadStream(filePath, {
    flags: 'r', encoding: null, fd: null, mode: '0666', autoClose: true,
  });
};

type AttachHandler = (pageId: string | null, attachment: IAttachmentDocument, file: Express.Multer.File) => Promise<void>;

type DetachHandler = (attachmentId: string) => Promise<void>;


type IAttachmentService = {
  createAttachment(
    file: Express.Multer.File, user: any, pageId: string | null, attachmentType: AttachmentType,
    disposeTmpFileCallback?: (file: Express.Multer.File) => void,
  ): Promise<IAttachmentDocument>;
  removeAllAttachments(attachments: IAttachmentDocument[]): Promise<void>;
  removeAttachment(attachmentId: Ref<IAttachment> | undefined): Promise<void>;
  isBrandLogoExist(): Promise<boolean>;
  addAttachHandler(handler: AttachHandler): void;
  addDetachHandler(handler: DetachHandler): void;
};


/**
 * the service class for Attachment and file-uploader
 */
export class AttachmentService implements IAttachmentService {

  attachHandlers: AttachHandler[] = [];

  detachHandlers: DetachHandler[] = [];

  crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  async createAttachment(file, user, pageId: string | null | undefined = null, attachmentType, disposeTmpFileCallback): Promise<IAttachmentDocument> {
    const { fileUploadService } = this.crowi;

    // check limit
    const res = await fileUploadService.checkLimit(file.size);
    if (!res.isUploadable) {
      throw new Error(res.errorMessage);
    }

    // create an Attachment document and upload file
    let attachment;
    let readStreamForCreateAttachmentDocument;
    try {
      readStreamForCreateAttachmentDocument = createReadStream(file.path);
      attachment = Attachment.createWithoutSave(pageId, user, file.originalname, file.mimetype, file.size, attachmentType);
      await fileUploadService.uploadAttachment(readStreamForCreateAttachmentDocument, attachment);
      await attachment.save();

      const attachHandlerPromises = this.attachHandlers.map((handler) => {
        return handler(pageId, attachment, file);
      });

      // Do not await, run in background
      Promise.all(attachHandlerPromises)
        .catch((err) => {
          logger.error('Error while executing attach handler', err);
        })
        .finally(() => {
          disposeTmpFileCallback?.(file);
        });
    }
    catch (err) {
      logger.error('Error while creating attachment', err);
      disposeTmpFileCallback?.(file);
      throw err;
    }
    finally {
      readStreamForCreateAttachmentDocument.destroy();
    }

    return attachment;
  }

  async removeAllAttachments(attachments: HydratedDocument<IAttachmentDocument>[]): Promise<void> {
    const { fileUploadService } = this.crowi;
    const attachmentsCollection = mongoose.connection.collection('attachments');
    const unorderAttachmentsBulkOp = attachmentsCollection.initializeUnorderedBulkOp();

    if (attachments.length === 0) {
      return;
    }

    attachments.forEach((attachment) => {
      unorderAttachmentsBulkOp.find({ _id: attachment._id }).delete();
    });
    await unorderAttachmentsBulkOp.execute();

    fileUploadService.deleteFiles(attachments);

    return;
  }

  async removeAttachment(attachmentId: Ref<IAttachment> | undefined): Promise<void> {
    const { fileUploadService } = this.crowi;
    const attachment = await Attachment.findById(attachmentId);

    if (attachment == null) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    await fileUploadService.deleteFile(attachment);
    await attachment.remove();

    const detachedHandlerPromises = this.detachHandlers.map((handler) => {
      return handler(attachment._id);
    });

    // Do not await, run in background
    Promise.all(detachedHandlerPromises)
      .catch((err) => {
        logger.error('Error while executing detached handler', err);
      });

    return;
  }

  async isBrandLogoExist(): Promise<boolean> {
    const query = { attachmentType: AttachmentType.BRAND_LOGO };
    const count = await Attachment.countDocuments(query);

    return count >= 1;
  }

  /**
   * Register a handler that will be called after attachment creation
   * @param {(pageId: string, attachment: Attachment, file: Express.Multer.File) => Promise<void>} handler
   */
  addAttachHandler(handler: AttachHandler): void {
    this.attachHandlers.push(handler);
  }

  /**
   * Register a handler that will be called before attachment deletion
   * @param {(attachmentId: string) => Promise<void>} handler
   */
  addDetachHandler(handler: DetachHandler): void {
    this.detachHandlers.push(handler);
  }

}
