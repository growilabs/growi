import type { ReadStream } from 'node:fs';
import { createReadStream } from 'node:fs';
import { ConfigSource } from '@growi/core';
import type { IUser } from '@growi/core/dist/interfaces';
// biome-ignore lint/style/noRestrictedImports: TODO: check effects of using custom axios
import rawAxios, { type AxiosRequestConfig } from 'axios';
import * as FormDataModule from 'form-data';
import mongoose, { Types as MongooseTypes } from 'mongoose';
import { basename } from 'pathe';

import { G2G_PROGRESS_STATUS } from '~/interfaces/g2g-transfer';
import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { ImportMode } from '~/models/admin/import-mode';
import TransferKeyModel from '~/server/models/transfer-key';
import { getImportService, type ImportSettings } from '~/server/service/import';
import type { ImportResult } from '~/server/service/import/import';
import { createBatchStream } from '~/server/util/batch-stream';
import axios from '~/utils/axios';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';
import { TransferKey } from '~/utils/vo/transfer-key';

import type Crowi from '../crowi';
import { Attachment } from '../models/attachment';
import UserGroup from '../models/user-group';
import {
  G2G_DATA_CONFLICT_ERROR_CODE,
  G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
  G2GTransferError,
  G2GTransferErrorCode,
} from '../models/vo/g2g-transfer-error';
import { configManager } from './config-manager';
import type { ConfigKey } from './config-manager/config-definition';
import { exportService } from './export';
import {
  detectUniqueConflicts,
  type UniqueConflictReport,
} from './import/detect-unique-conflicts';
import { generateOverwriteParams } from './import/overwrite-params';

const logger = loggerFactory('growi:service:g2g-transfer');

const FormData = FormDataModule.default ?? FormDataModule;

/**
 * Header name for transfer key
 */
export const X_GROWI_TRANSFER_KEY_HEADER_NAME = 'x-growi-transfer-key';

/**
 * How often an in-flight request pushes the transfer key's expiry forward.
 *
 * The key is removed by a MongoDB TTL index 30 minutes after `expireAt`
 * (models/transfer-key.ts), and a single request can outlast that on its own: receiving
 * the archive over the network, unzipping it, checking the version, detecting conflicts,
 * importing every collection and normalizing pages all happen before the response is
 * written. Touching the key on arrival only buys one more 30-minute window for all of
 * that, so the touch repeats while the request is in flight. The interval only has to be
 * comfortably below the TTL; one write per minute per in-flight transfer is negligible.
 */
export const TRANSFER_KEY_KEEP_ALIVE_INTERVAL_MS = 60 * 1000;

interface ReceiverOptions {
  /**
   * Overrides {@link TRANSFER_KEY_KEEP_ALIVE_INTERVAL_MS}. Exists so a test can observe
   * the repetition — with the production interval, the only thing an assertion could
   * reach within a test run is the touch that happens on arrival.
   */
  readonly transferKeyKeepAliveIntervalMs?: number;
}

/**
 * How often the source GROWI reminds the destination that a transfer is still coming,
 * while it builds the archive.
 *
 * Exporting every collection and zipping the result is one uninterrupted stretch of work
 * during which the destination hears nothing at all, and it handles the same volume of
 * data as the import — so a transfer big enough for the import to outlast the key is one
 * where the export does too. Nothing has reached the destination by then, so what is lost
 * is the entire transfer.
 */
export const PUSHER_KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000;

interface PusherOptions {
  /** Overrides {@link PUSHER_KEEP_ALIVE_INTERVAL_MS}; see {@link ReceiverOptions}. */
  readonly transferKeyKeepAliveIntervalMs?: number;
}

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
 * One entry of the file list `growiBridgeService.parseZipFile` reports for an unzipped
 * archive. The receive route also carries `size`, which the conflict detection ignores.
 */
type InnerFileStat = {
  fileName: string;
  collectionName: string;
};

/**
 * The export service decides the inner file names, so which collection a file holds is
 * only knowable from `collectionName`. Returns null when the collection is not part of
 * the transfer at all.
 */
const findInnerFileName = (
  innerFileStats: InnerFileStat[],
  collectionName: string,
): string | null =>
  innerFileStats.find((stat) => stat.collectionName === collectionName)
    ?.fileName ?? null;

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
   * Keep the transfer key from expiring while a request that uses it is in flight.
   * @param {string} key Transfer key
   * @returns {() => void} Stops the extension. The caller MUST call it when the response
   * closes — on completion *and* on a client disconnect, or the key never expires again.
   */
  startTransferKeyKeepAlive(key: string): () => void;
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
   * Detect unique field conflicts between the unzipped archive and the existing data of
   * this GROWI, so that the caller can stop the import before any document is written.
   * Detection only reads; a collection that is not part of the transfer is skipped.
   * @param {InnerFileStat[]} innerFileStats File list of the unzipped archive
   * @returns {Promise<UniqueConflictReport>} Every detected conflict
   */
  detectImportConflicts(
    innerFileStats: InnerFileStat[],
    replaceTargetCollections?: ReadonlySet<string>,
  ): Promise<UniqueConflictReport>;
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
  ): Promise<ImportResult>;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Payload the pusher's `admin:g2gError` socket event carries for a failed archive POST.
 * `key` selects the client's i18n heading; `message` is the detail shown alongside it.
 */
interface ArchivePostErrorEvent {
  key: string;
  message: string;
}

const GENERIC_ARCHIVE_POST_ERROR_EVENT: ArchivePostErrorEvent = {
  message: 'Failed to send GROWI archive file to the destination GROWI',
  key: 'admin:g2g:error_send_growi_archive',
};

/**
 * The receiver's error codes that the operator on this side is told about specifically.
 * Anything not listed here falls back to the generic event, as it did before.
 */
const ARCHIVE_POST_ERROR_KEY_BY_CODE: ReadonlyMap<string, string> = new Map([
  [G2G_DATA_CONFLICT_ERROR_CODE, 'admin:g2g:error_data_conflict'],
  [G2G_IMPORT_IN_PROGRESS_ERROR_CODE, 'admin:g2g:error_import_in_progress'],
]);

/**
 * Maps a failed archive POST to the admin-facing `admin:g2gError` payload.
 *
 * Pure / no I/O, so it is unit-testable without mocking axios, exportService, or the
 * filesystem (see g2g-transfer.spec.ts) — the framework-facing catch in `startTransfer`
 * reduces to a thin call of this function.
 *
 * The receive route answers a data conflict with `{ errors: [{ message, code:
 * G2G_DATA_CONFLICT_ERROR_CODE }] }` (apiv3Err), but that shape is untrusted at this
 * network boundary: a network failure carries no `response` at all, and a proxy error
 * page or a future receiver change could reshape the body. Every access below is
 * therefore a guarded read, and anything it does not recognize falls back to the same
 * generic event `startTransfer` emitted before this function existed.
 */
export const toArchivePostErrorEvent = (
  err: unknown,
): ArchivePostErrorEvent => {
  if (
    !isRecord(err) ||
    !isRecord(err.response) ||
    !isRecord(err.response.data)
  ) {
    return GENERIC_ARCHIVE_POST_ERROR_EVENT;
  }

  const { errors } = err.response.data;
  const firstError = Array.isArray(errors) ? errors[0] : undefined;

  if (!isRecord(firstError)) {
    return GENERIC_ARCHIVE_POST_ERROR_EVENT;
  }

  const { code, message } = firstError;

  const key =
    typeof code === 'string'
      ? ARCHIVE_POST_ERROR_KEY_BY_CODE.get(code)
      : undefined;

  if (key == null || typeof message !== 'string') {
    return GENERIC_ARCHIVE_POST_ERROR_EVENT;
  }

  return { key, message };
};

/**
 * Reads the collections the destination failed to import out of its response to the
 * archive.
 *
 * Guarded the whole way down, like {@link toArchivePostErrorEvent}: this is a network
 * boundary, an older destination answers without the field at all, and a proxy can
 * replace the body with something else entirely. Anything unrecognized reads as "nothing
 * failed", which is what this code assumed before the field existed.
 */
export const readFailedCollections = (
  responseData: unknown,
): readonly string[] => {
  if (!isRecord(responseData)) {
    return [];
  }

  const { failedCollections } = responseData;

  return Array.isArray(failedCollections)
    ? failedCollections.filter(
        (name): name is string => typeof name === 'string',
      )
    : [];
};

/**
 * G2g transfer pusher
 */
export class G2GTransferPusherService implements Pusher {
  crowi: Crowi;

  private readonly transferKeyKeepAliveIntervalMs: number;

  constructor(crowi: Crowi, options: PusherOptions = {}) {
    this.crowi = crowi;
    this.transferKeyKeepAliveIntervalMs =
      options.transferKeyKeepAliveIntervalMs ?? PUSHER_KEEP_ALIVE_INTERVAL_MS;
  }

  /**
   * Reminds the destination that this transfer is still coming, for as long as the
   * returned function is not called.
   *
   * Uses the dedicated keep-alive endpoint rather than `growi-info`: answering that one
   * writes a probe file to the destination's attachment storage and never deletes it, so
   * polling it every few minutes would litter the destination for the length of every
   * export.
   */
  private startTransferKeyKeepAlive(tk: TransferKey): () => void {
    const touch = async (): Promise<void> => {
      try {
        await axios.post(
          '/_api/v3/g2g-transfer/keep-alive',
          null,
          this.generateAxiosConfig(tk),
        );
      } catch (err) {
        // The destination being briefly unreachable costs the key some of its remaining
        // window; failing the transfer over it would cost the whole export.
        logger.warn('Failed to extend the lifetime of the transfer key', err);
      }
    };

    // No immediate call: the caller has just spoken to the destination, so the key was
    // touched moments ago.
    const timer = setInterval(() => {
      void touch();
    }, this.transferKeyKeepAliveIntervalMs);
    timer.unref();

    return () => clearInterval(timer);
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

    const User = mongoose.model<IUser, any>('User');
    const activeUserCount = await User.countActiveUsers();
    if ((destGROWIInfo.userUpperLimit ?? Infinity) < activeUserCount) {
      return {
        canTransfer: false,
        // TODO: i18n for reason
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

    // Exporting and zipping is the one stretch of the transfer during which the
    // destination hears nothing from this GROWI, and it is as long as the import. Without
    // this the key can expire before the archive has been handed over at all.
    const stopTransferKeyKeepAlive = this.startTransferKeyKeepAlive(tk);

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
    } finally {
      // Everything from here on is a request to the destination, which extends the key by
      // arriving.
      stopTransferKeyKeepAlive();
    }

    // Send a zip file to other GROWI via axios
    let archiveResponseData: unknown;
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
      const { data } = await rawAxios.post(
        '/_api/v3/g2g-transfer/',
        form,
        this.generateAxiosConfig(tk, { headers: form.getHeaders() }),
      );
      archiveResponseData = data;
    } catch (err) {
      logger.error(err);
      socket?.emit('admin:g2gProgress', {
        mongo: G2G_PROGRESS_STATUS.ERROR,
        attachments: G2G_PROGRESS_STATUS.PENDING,
      });
      socket?.emit('admin:g2gError', toArchivePostErrorEvent(err));
      throw err;
    }

    // A 200 only means the destination finished trying. Which collections it could not
    // import is in the body, and this is the only place that fact can be read: the two
    // GROWIs are separate processes and these notifications are emitted by this one.
    const failedCollections = readFailedCollections(archiveResponseData);
    if (failedCollections.length > 0) {
      logger.error(
        { failedCollections },
        'The destination GROWI could not import every collection',
      );
      socket?.emit('admin:g2gProgress', {
        mongo: G2G_PROGRESS_STATUS.ERROR,
        attachments: G2G_PROGRESS_STATUS.PENDING,
        failedCollections,
      });
      socket?.emit('admin:g2gError', {
        key: 'admin:g2g:error_partial_import',
        message: `Collections that could not be imported: ${failedCollections.join(', ')}`,
      });
      // The attachments are not sent: the destination holds a partly imported database
      // and has to be transferred again, so pushing files into it now would only make the
      // retry slower. Reporting completion here is what requirement 2.5 rules out.
      return;
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

  private readonly transferKeyKeepAliveIntervalMs: number;

  constructor(crowi: Crowi, options: ReceiverOptions = {}) {
    this.crowi = crowi;
    this.transferKeyKeepAliveIntervalMs =
      options.transferKeyKeepAliveIntervalMs ??
      TRANSFER_KEY_KEEP_ALIVE_INTERVAL_MS;
  }

  public startTransferKeyKeepAlive(key: string): () => void {
    // Moving `expireAt` to now restarts the TTL index's 30-minute countdown, so the key
    // keeps the meaning it had before: it expires 30 minutes after the last time this
    // GROWI heard from the transfer, not 30 minutes after it was issued.
    const touch = async (): Promise<void> => {
      try {
        await TransferKeyModel.updateOne({ key }, { expireAt: new Date() });
      } catch (err) {
        // A failed touch costs the key some of its remaining window; failing the
        // transfer over it would cost the whole transfer.
        logger.warn('Failed to extend the lifetime of the transfer key', err);
      }
    };

    void touch();

    const timer = setInterval(() => {
      void touch();
    }, this.transferKeyKeepAliveIntervalMs);
    // A transfer must not be the reason the process refuses to shut down.
    timer.unref();

    return () => clearInterval(timer);
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
    const fileUploadDisabled =
      configManager.getConfig('app:fileUploadType') === 'none';
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

  public async detectImportConflicts(
    innerFileStats: InnerFileStat[],
    replaceTargetCollections?: ReadonlySet<string>,
  ): Promise<UniqueConflictReport> {
    const importService = getImportService();

    // A declared file that cannot be resolved must throw rather than be downgraded to
    // "this collection is not part of the transfer": treating it as absent would let the
    // import run and drop the conflicting documents silently (issue #10151).
    const resolvePath = (collectionName: string): string | null => {
      const fileName = findInnerFileName(innerFileStats, collectionName);
      return fileName == null ? null : importService.getFile(fileName);
    };

    return detectUniqueConflicts({
      usersJsonPath: resolvePath('users'),
      groupsJsonPath: resolvePath('usergroups'),
      userModel: mongoose.model<IUser>('User'),
      userGroupModel: UserGroup,
      replaceTargetCollections,
    });
  }

  public async importCollections(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
    sourceGROWIUploadConfigs: FileUploadConfigs,
  ): Promise<ImportResult> {
    const { appService } = this.crowi;
    const importService = getImportService();
    /** whether to keep current file upload configs */
    const shouldKeepUploadConfigs =
      configManager.getConfig('app:fileUploadType') !== 'none';

    let importResult: ImportResult;

    if (shouldKeepUploadConfigs) {
      /** cache file upload configs */
      const fileUploadConfigs = await this.getFileUploadConfigs();

      // import mongo collections(overwrites file uplaod configs)
      importResult = await importService.import(collections, importSettingsMap);

      // restore file upload config from cache
      await configManager.removeConfigs(UPLOAD_CONFIG_KEYS);
      await configManager.updateConfigs(fileUploadConfigs);
    } else {
      // import mongo collections(overwrites file uplaod configs)
      importResult = await importService.import(collections, importSettingsMap);

      // update file upload config
      await configManager.updateConfigs(sourceGROWIUploadConfigs);
    }

    await this.crowi.setUpFileUpload(true);
    await appService.setupAfterInstall();

    // Handed back so the route can put it in the response: the source is a different
    // process, and its own progress events cannot know what happened over here.
    return importResult;
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
