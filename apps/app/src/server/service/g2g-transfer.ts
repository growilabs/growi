import { ConfigSource } from '@growi/core';
import type { IUser } from '@growi/core/dist/interfaces';
// biome-ignore lint/style/noRestrictedImports: TODO: check effects of using custom axios
import rawAxios, { type AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import type { ReadStream } from 'fs';
import { createReadStream } from 'fs';
import mongoose, {
  type HydratedDocument,
  Types as MongooseTypes,
} from 'mongoose';
import { basename } from 'path';

import { G2G_PROGRESS_STATUS } from '~/interfaces/g2g-transfer';
import type { ITransferKey } from '~/interfaces/transfer-key';
import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { ImportMode } from '~/models/admin/import-mode';
import TransferKeyModel from '~/server/models/transfer-key';
import { getImportService, type ImportSettings } from '~/server/service/import';
import { createBatchStream } from '~/server/util/batch-stream';
import axios from '~/utils/axios';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';
import { TransferKey } from '~/utils/vo/transfer-key';

import type Crowi from '../crowi';
import { Attachment } from '../models/attachment';
import {
  G2GTransferError,
  G2GTransferErrorCode,
} from '../models/vo/g2g-transfer-error';
import { configManager } from './config-manager';
import type { ConfigKey } from './config-manager/config-definition';
import { exportService } from './export';
import { generateOverwriteParams } from './import/overwrite-params';

const logger = loggerFactory('growi:service:g2g-transfer');

/**
 * Header name for transfer key
 */
export const X_GROWI_TRANSFER_KEY_HEADER_NAME = 'x-growi-transfer-key';

/**
 * Keys for file upload related config
 */
const UPLOAD_CONFIG_KEYS = [
  'app:fileUploadType',
  'env:useOnlyEnvVars:app:fileUploadType',
  'aws:referenceFileWithRelayMode',
  'aws:lifetimeSecForTemporaryUrl',
  'gcs:apiKeyJsonPath',
  'gcs:bucket',
  'gcs:uploadNamespace',
  'gcs:referenceFileWithRelayMode',
  'env:useOnlyEnvVars:gcs',
  'azure:storageAccountName',
  'azure:storageContainerName',
  'azure:referenceFileWithRelayMode',
  'env:useOnlyEnvVars:azure',
] satisfies ConfigKey[];

/**
 * File upload related configs
 */
type FileUploadConfigs = { [key in (typeof UPLOAD_CONFIG_KEYS)[number]]: any };

/**
 * Data used for comparing to/from GROWI information
 */
export type IDataGROWIInfo = {
  /** GROWI version */
  version: string;
  /** Max user count */
  userUpperLimit: number | null; // Handle null as Infinity
  /** Whether file upload is disabled */
  fileUploadDisabled: boolean;
  /** Total file size allowed */
  fileUploadTotalLimit: number | null; // Handle null as Infinity
  /** Attachment infromation */
  attachmentInfo: {
    /** File storage type */
    type: string;
    /** Whether the storage is writable */
    writable: boolean;
    /** Bucket name (S3 and GCS only) */
    bucket?: string;
    /** S3 custom endpoint */
    customEndpoint?: string;
    /** GCS namespace */
    uploadNamespace?: string;
    /** Azure account name */
    accountName?: string;
    /** Azure container name */
    containerName?: string;
  };
};

/**
 * File metadata in storage
 * TODO: mv this to "./file-uploader/uploader"
 */
interface FileMeta {
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
}

/**
 * Return type for {@link Pusher.getTransferability}
 */
type Transferability =
  | { canTransfer: true }
  | { canTransfer: false; reason: string };

/**
 * G2g transfer pusher
 */
interface Pusher {
  /**
   * Merge axios config with transfer key
   * @param {TransferKey} tk Transfer key
   * @param {AxiosRequestConfig} config Axios config
   */
  generateAxiosConfig(
    tk: TransferKey,
    config: AxiosRequestConfig,
  ): AxiosRequestConfig;
  /**
   * Send to-growi a request to get GROWI info
   * @param {TransferKey} tk Transfer key
   */
  askGROWIInfo(tk: TransferKey): Promise<IDataGROWIInfo>;
  /**
   * Check if transfering is proceedable
   * @param {IDataGROWIInfo} destGROWIInfo GROWI info from dest GROWI
   */
  getTransferability(destGROWIInfo: IDataGROWIInfo): Promise<Transferability>;
  /**
   * List files in the storage
   * @param {TransferKey} tk Transfer key
   */
  listFilesInStorage(tk: TransferKey): Promise<FileMeta[]>;
  /**
   * Transfer all Attachment data to dest GROWI
   * @param {TransferKey} tk Transfer key
   */
  transferAttachments(tk: TransferKey): Promise<void>;
  /**
   * Start transfer data between GROWIs
   * @param {TransferKey} tk TransferKey object
   * @param {any} user User operating g2g transfer
   * @param {IDataGROWIInfo} destGROWIInfo GROWI info of dest GROWI
   * @param {string[]} collections Collection name string array
   * @param {any} optionsMap Options map
   */
  startTransfer(
    tk: TransferKey,
    user: any,
    collections: string[],
    optionsMap: any,
    destGROWIInfo: IDataGROWIInfo,
  ): Promise<void>;
}

/**
 * G2g transfer receiver
 */
interface Receiver {
  /**
   * Check if key is not expired
   * @throws {import('../models/vo/g2g-transfer-error').G2GTransferError}
   * @param {string} key Transfer key
   */
  validateTransferKey(key: string): Promise<void>;
  /**
   * Generate GROWIInfo
   * @throws {import('../models/vo/g2g-transfer-error').G2GTransferError}
   */
  answerGROWIInfo(): Promise<IDataGROWIInfo>;
  /**
   * DO NOT USE TransferKeyModel.create() directly, instead, use this method to create a TransferKey document.
   * This method receives appSiteUrlOrigin to create a TransferKey document and returns generated transfer key string.
   * UUID is the same value as the created document's _id.
   * @param {string} appSiteUrlOrigin GROWI app site URL origin
   * @returns {string} Transfer key string (e.g. http://localhost:3000__grw_internal_tranferkey__<uuid>)
   */
  createTransferKey(appSiteUrlOrigin: string): Promise<string>;
  /**
   * Returns a map of collection name and ImportSettings
   * @param {any[]} innerFileStats
   * @param {{ [key: string]: GrowiArchiveImportOption; }} optionsMap Map of collection name and GrowiArchiveImportOption
   * @param {string} operatorUserId User ID
   * @returns {{ [key: string]: ImportSettings; }} Map of collection name and ImportSettings
   */
  getImportSettingMap(
    innerFileStats: any[],
    optionsMap: { [key: string]: GrowiArchiveImportOption },
    operatorUserId: string,
  ): Map<string, ImportSettings>;
  /**
   * Import collections
   * @param {string} collections Array of collection name
   * @param {{ [key: string]: ImportSettings; }} importSettingsMap Map of collection name and ImportSettings
   * @param {FileUploadConfigs} sourceGROWIUploadConfigs File upload configs from src GROWI
   */
  importCollections(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
    sourceGROWIUploadConfigs: FileUploadConfigs,
  ): Promise<void>;
  /**
   * Returns file upload configs
   */
  getFileUploadConfigs(): Promise<FileUploadConfigs>;
  /**
   * Update file upload configs
   * @param fileUploadConfigs  File upload configs
   */
  updateFileUploadConfigs(fileUploadConfigs: FileUploadConfigs): Promise<void>;
  /**
   * Upload attachment file
   * @param {ReadStream} content Pushed attachment data from source GROWI
   * @param {any} attachmentMap Map-ped Attachment instance
   */
  receiveAttachment(content: ReadStream, attachmentMap: any): Promise<void>;
}

/**
 * G2g transfer pusher
 */
export class G2GTransferPusherService implements Pusher {
  crowi: Crowi;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(crowi: any) {
    this.crowi = crowi;
  }

  public generateAxiosConfig(
    tk: TransferKey,
    baseConfig: AxiosRequestConfig = {},
  ): AxiosRequestConfig {
    const { appSiteUrlOrigin, key } = tk;

    return {
      ...baseConfig,
      baseURL: appSiteUrlOrigin,
      headers: {
        ...baseConfig.headers,
        [X_GROWI_TRANSFER_KEY_HEADER_NAME]: key,
      },
      maxBodyLength: Infinity,
    };
  }

  public async askGROWIInfo(tk: TransferKey): Promise<IDataGROWIInfo> {
    try {
      const {
        data: { growiInfo },
      } = await axios.get(
        '/_api/v3/g2g-transfer/growi-info',
        this.generateAxiosConfig(tk),
      );
      return growiInfo;
    } catch (err) {
      logger.error(err);
      throw new G2GTransferError(
        'Failed to retrieve GROWI info.',
        G2GTransferErrorCode.FAILED_TO_RETRIEVE_GROWI_INFO,
      );
    }
  }

  public async getTransferability(
    destGROWIInfo: IDataGROWIInfo,
  ): Promise<Transferability> {
    const { fileUploadService } = this.crowi;

    const version = getGrowiVersion();
    if (version !== destGROWIInfo.version) {
      return {
        canTransfer: false,
        // TODO: i18n for reason
        reason: `GROWI versions mismatch. src GROWI: ${version} / dest GROWI: ${destGROWIInfo.version}.`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const User = mongoose.model<IUser, any>('User');
    const activeUserCount = await User.countActiveUsers();
    if ((destGROWIInfo.userUpperLimit ?? Infinity) < activeUserCount) {
      return {
        canTransfer: false,
        // TODO: i18n for reason
        // eslint-disable-next-line max-len
        reason: `The number of active users (${activeUserCount} users) exceeds the limit of the destination GROWI (up to ${destGROWIInfo.userUpperLimit} users).`,
      };
    }

    if (destGROWIInfo.fileUploadDisabled) {
      return {
        canTransfer: false,
        // TODO: i18n for reason
        reason: 'The file upload setting is disabled in the destination GROWI.',
      };
    }

    if (configManager.getConfig('app:fileUploadType') === 'none') {
      return {
        canTransfer: false,
        // TODO: i18n for reason
        reason: 'File upload is not configured for src GROWI.',
      };
    }

    if (destGROWIInfo.attachmentInfo.type === 'none') {
      return {
        canTransfer: false,
        // TODO: i18n for reason
        reason: 'File upload is not configured for dest GROWI.',
      };
    }

    if (!destGROWIInfo.attachmentInfo.writable) {
      return {
        canTransfer: false,
        // TODO: i18n for reason
        reason: 'The storage of the destination GROWI is not writable.',
      };
    }

    const totalFileSize = await fileUploadService.getTotalFileSize();
    if ((destGROWIInfo.fileUploadTotalLimit ?? Infinity) < totalFileSize) {
      return {
        canTransfer: false,
        // TODO: i18n for reason
        // eslint-disable-next-line max-len
        reason: `The total file size of attachments exceeds the file upload limit of the destination GROWI. Requires ${totalFileSize.toLocaleString()} bytes, but got ${(destGROWIInfo.fileUploadTotalLimit as number).toLocaleString()} bytes.`,
      };
    }

    return { canTransfer: true };
  }

  public async listFilesInStorage(tk: TransferKey): Promise<FileMeta[]> {
    try {
      const {
        data: { files },
      } = await axios.get<{ files: FileMeta[] }>(
        '/_api/v3/g2g-transfer/files',
        this.generateAxiosConfig(tk),
      );
      return files;
    } catch (err) {
      logger.error(err);
      throw new G2GTransferError(
        'Failed to retrieve file metadata',
        G2GTransferErrorCode.FAILED_TO_RETRIEVE_FILE_METADATA,
      );
    }
  }

  public async transferAttachments(tk: TransferKey): Promise<void> {
    const BATCH_SIZE = 100;
    const { fileUploadService, socketIoService } = this.crowi;
    const socket = socketIoService?.getAdminSocket();
    const filesFromSrcGROWI = await this.listFilesInStorage(tk);

    /**
     * Given these documents,
     *
     * | fileName | fileSize |
     * | -- | -- |
     * | a.png | 1024 |
     * | b.png | 2048 |
     * | c.png | 1024 |
     * | d.png | 2048 |
     *
     * this filter
     *
     * ```jsonc
     * {
     *   $and: [
     *     // a file transferred
     *     {
     *       $or: [
     *         { fileName: { $ne: "a.png" } },
     *         { fileSize: { $ne: 1024 } }
     *       ]
     *     },
     *     // a file failed to transfer
     *     {
     *       $or: [
     *         { fileName: { $ne: "b.png" } },
     *         { fileSize: { $ne: 0 } }
     *       ]
     *     }
     *   ]
     * }
     * ```
     *
     * results in
     *
     * | fileName | fileSize |
     * | -- | -- |
     * | b.png | 2048 |
     * | c.png | 1024 |
     * | d.png | 2048 |
     */
    const filter =
      filesFromSrcGROWI.length > 0
        ? {
            $and: filesFromSrcGROWI.map(({ name, size }) => ({
              $or: [
                { fileName: { $ne: basename(name) } },
                { fileSize: { $ne: size } },
              ],
            })),
          }
        : {};
    const attachmentsCursor = await Attachment.find(filter).cursor();
    const batchStream = createBatchStream(BATCH_SIZE);

    for await (const attachmentBatch of attachmentsCursor.pipe(batchStream)) {
      for await (const attachment of attachmentBatch) {
        logger.debug(`processing attachment: ${attachment}`);
        let fileStream: NodeJS.ReadableStream;
        try {
          // get read stream of each attachment
          fileStream = await fileUploadService.findDeliveryFile(attachment);
        } catch (err) {
          logger.warn(
            `Error occured when getting Attachment(ID=${attachment.id}), skipping: `,
            err,
          );
          socket?.emit('admin:g2gError', {
            message: `Error occured when uploading Attachment(ID=${attachment.id})`,
            key: `Error occured when uploading Attachment(ID=${attachment.id})`,
            // TODO: emit error with params
            // key: 'admin:g2g:error_upload_attachment',
          });
          continue;
        }
        // post each attachment file data to receiver
        try {
          await this.doTransferAttachment(tk, attachment, fileStream);
        } catch (err) {
          logger.error(
            `Error occured when uploading attachment(ID=${attachment.id})`,
            err,
          );
          socket?.emit('admin:g2gError', {
            message: `Error occured when uploading Attachment(ID=${attachment.id})`,
            key: `Error occured when uploading Attachment(ID=${attachment.id})`,
            // TODO: emit error with params
            // key: 'admin:g2g:error_upload_attachment',
          });
        }
      }
    }
  }

  // eslint-disable-next-line max-len
  public async startTransfer(
    tk: TransferKey,
    user: any,
    collections: string[],
    optionsMap: any,
    destGROWIInfo: IDataGROWIInfo,
  ): Promise<void> {
    const socket = this.crowi.socketIoService?.getAdminSocket();

    socket?.emit('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.IN_PROGRESS,
      attachments: G2G_PROGRESS_STATUS.PENDING,
    });

    const targetConfigKeys = UPLOAD_CONFIG_KEYS;

    const uploadConfigs = Object.fromEntries(
      targetConfigKeys.map((key) => {
        return [key, configManager.getConfig(key)];
      }),
    );

    let zipFileStream: ReadStream;
    try {
      const zipFileStat = await exportService?.export(collections);
      const zipFilePath = zipFileStat?.zipFilePath;

      if (zipFilePath == null) throw new Error('Failed to generate zip file');

      zipFileStream = createReadStream(zipFilePath);
    } catch (err) {
      logger.error(err);
      socket?.emit('admin:g2gProgress', {
        mongo: G2G_PROGRESS_STATUS.ERROR,
        attachments: G2G_PROGRESS_STATUS.PENDING,
      });
      socket?.emit('admin:g2gError', {
        message: 'Failed to generate GROWI archive file',
        key: 'admin:g2g:error_generate_growi_archive',
      });
      throw err;
    }

    // Send a zip file to other GROWI via axios
    try {
      // Use FormData to immitate browser's form data object
      const form = new FormData();

      const appTitle = this.crowi.appService.getAppTitle();
      form.append(
        'transferDataZipFile',
        zipFileStream,
        `${appTitle}-${Date.now}.growi.zip`,
      );
      form.append('collections', JSON.stringify(collections));
      form.append('optionsMap', JSON.stringify(optionsMap));
      form.append('operatorUserId', user._id.toString());
      form.append('uploadConfigs', JSON.stringify(uploadConfigs));
      await rawAxios.post(
        '/_api/v3/g2g-transfer/',
        form,
        this.generateAxiosConfig(tk, { headers: form.getHeaders() }),
      );
    } catch (err) {
      logger.error(err);
      socket?.emit('admin:g2gProgress', {
        mongo: G2G_PROGRESS_STATUS.ERROR,
        attachments: G2G_PROGRESS_STATUS.PENDING,
      });
      socket?.emit('admin:g2gError', {
        message: 'Failed to send GROWI archive file to the destination GROWI',
        key: 'admin:g2g:error_send_growi_archive',
      });
      throw err;
    }

    socket?.emit('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.COMPLETED,
      attachments: G2G_PROGRESS_STATUS.IN_PROGRESS,
    });

    try {
      await this.transferAttachments(tk);
    } catch (err) {
      logger.error(err);
      socket?.emit('admin:g2gProgress', {
        mongo: G2G_PROGRESS_STATUS.COMPLETED,
        attachments: G2G_PROGRESS_STATUS.ERROR,
      });
      socket?.emit('admin:g2gError', {
        message: 'Failed to transfer attachments',
        key: 'admin:g2g:error_upload_attachment',
      });
      throw err;
    }

    socket?.emit('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.COMPLETED,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
    });
  }

  /**
   * Transfer attachment to dest GROWI
   * @param {TransferKey} tk Transfer key
   * @param {any} attachment Attachment model instance
   * @param {NodeJS.ReadableStream} fileStream Attachment data(loaded from storage)
   */
  private async doTransferAttachment(
    tk: TransferKey,
    attachment: any,
    fileStream: NodeJS.ReadableStream,
  ): Promise<void> {
    // Use FormData to immitate browser's form data object
    const form = new FormData();

    form.append('content', fileStream, attachment.fileName);
    form.append('attachmentMetadata', JSON.stringify(attachment));
    await rawAxios.post(
      '/_api/v3/g2g-transfer/attachment',
      form,
      this.generateAxiosConfig(tk, { headers: form.getHeaders() }),
    );
  }
}

/**
 * G2g transfer receiver
 */
export class G2GTransferReceiverService implements Receiver {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  public async validateTransferKey(key: string): Promise<void> {
    const transferKey = await (TransferKeyModel as any).findOne({ key });

    if (transferKey == null) {
      throw new Error(`Transfer key "${key}" was expired or not found`);
    }

    try {
      TransferKey.parse(transferKey.keyString);
    } catch (err) {
      logger.error(err);
      throw new Error(`Transfer key "${key}" is invalid`);
    }
  }

  public async answerGROWIInfo(): Promise<IDataGROWIInfo> {
    const { fileUploadService } = this.crowi;
    const version = getGrowiVersion();
    const userUpperLimit = configManager.getConfig('security:userUpperLimit');
    const fileUploadDisabled = configManager.getConfig(
      'app:fileUploadDisabled',
    );
    const fileUploadTotalLimit = fileUploadService.getFileUploadTotalLimit();
    const isWritable = await fileUploadService.isWritable();

    const attachmentInfo: IDataGROWIInfo['attachmentInfo'] = {
      type: configManager.getConfig('app:fileUploadType'),
      writable: isWritable,
      bucket: undefined,
      customEndpoint: undefined, // for S3
      uploadNamespace: undefined, // for GCS
      accountName: undefined, // for Azure Blob
      containerName: undefined,
    };

    // put storage location info to check storage identification
    switch (attachmentInfo.type) {
      case 'aws':
        attachmentInfo.bucket = configManager.getConfig('aws:s3Bucket');
        attachmentInfo.customEndpoint = configManager.getConfig(
          'aws:s3CustomEndpoint',
        );
        break;
      case 'gcs':
        attachmentInfo.bucket = configManager.getConfig('gcs:bucket');
        attachmentInfo.uploadNamespace = configManager.getConfig(
          'gcs:uploadNamespace',
        );
        break;
      case 'azure':
        attachmentInfo.accountName = configManager.getConfig(
          'azure:storageAccountName',
        );
        attachmentInfo.containerName = configManager.getConfig(
          'azure:storageContainerName',
        );
        break;
      default:
    }

    return {
      userUpperLimit,
      fileUploadDisabled,
      fileUploadTotalLimit,
      version,
      attachmentInfo,
    };
  }

  public async createTransferKey(appSiteUrlOrigin: string): Promise<string> {
    const uuid = new MongooseTypes.ObjectId().toString();
    const transferKeyString = TransferKey.generateKeyString(
      uuid,
      appSiteUrlOrigin,
    );

    // Save TransferKey document
    let tkd: any;
    try {
      tkd = await TransferKeyModel.create({
        _id: uuid,
        keyString: transferKeyString,
        key: uuid,
      });
    } catch (err) {
      logger.error(err);
      throw err;
    }

    return tkd.keyString;
  }

  public getImportSettingMap(
    innerFileStats: any[],
    optionsMap: { [key: string]: GrowiArchiveImportOption },
    operatorUserId: string,
  ): Map<string, ImportSettings> {
    const importSettingsMap = new Map<string, ImportSettings>();
    innerFileStats.forEach(({ fileName, collectionName }) => {
      const options = new GrowiArchiveImportOption(
        collectionName,
        undefined,
        optionsMap[collectionName],
      );

      if (
        collectionName === 'configs' &&
        options.mode !== ImportMode.flushAndInsert
      ) {
        throw new Error(
          '`flushAndInsert` is only available as an import setting for configs collection',
        );
      }
      if (collectionName === 'pages' && options.mode === ImportMode.insert) {
        throw new Error(
          '`insert` is not available as an import setting for pages collection',
        );
      }
      if (collectionName === 'attachmentFiles.chunks') {
        throw new Error(
          '`attachmentFiles.chunks` must not be transferred. Please omit it from request body `collections`.',
        );
      }
      if (collectionName === 'attachmentFiles.files') {
        throw new Error(
          '`attachmentFiles.files` must not be transferred. Please omit it from request body `collections`.',
        );
      }

      const importSettings: ImportSettings = {
        mode: options.mode,
        jsonFileName: fileName,
        overwriteParams: generateOverwriteParams(
          collectionName,
          operatorUserId,
          options,
        ),
      };
      importSettingsMap.set(collectionName, importSettings);
    });

    return importSettingsMap;
  }

  public async importCollections(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
    sourceGROWIUploadConfigs: FileUploadConfigs,
  ): Promise<void> {
    const { appService } = this.crowi;
    const importService = getImportService();
    /** whether to keep current file upload configs */
    const shouldKeepUploadConfigs =
      configManager.getConfig('app:fileUploadType') !== 'none';

    if (shouldKeepUploadConfigs) {
      /** cache file upload configs */
      const fileUploadConfigs = await this.getFileUploadConfigs();

      // import mongo collections(overwrites file uplaod configs)
      await importService.import(collections, importSettingsMap);

      // restore file upload config from cache
      await configManager.removeConfigs(UPLOAD_CONFIG_KEYS);
      await configManager.updateConfigs(fileUploadConfigs);
    } else {
      // import mongo collections(overwrites file uplaod configs)
      await importService.import(collections, importSettingsMap);

      // update file upload config
      await configManager.updateConfigs(sourceGROWIUploadConfigs);
    }

    await this.crowi.setUpFileUpload(true);
    await appService.setupAfterInstall();
  }

  public async getFileUploadConfigs(): Promise<FileUploadConfigs> {
    const fileUploadConfigs = Object.fromEntries(
      UPLOAD_CONFIG_KEYS.map((key) => {
        return [key, configManager.getConfig(key, ConfigSource.db)];
      }),
    ) as FileUploadConfigs;

    return fileUploadConfigs;
  }

  public async updateFileUploadConfigs(
    fileUploadConfigs: FileUploadConfigs,
  ): Promise<void> {
    const { appService } = this.crowi;

    await configManager.removeConfigs(
      Object.keys(fileUploadConfigs) as ConfigKey[],
    );
    await configManager.updateConfigs(fileUploadConfigs);
    await this.crowi.setUpFileUpload(true);
    await appService.setupAfterInstall();
  }

  public async receiveAttachment(
    content: ReadStream,
    attachmentMap,
  ): Promise<void> {
    const { fileUploadService } = this.crowi;
    return fileUploadService.uploadAttachment(content, attachmentMap);
  }
}
