import { createHash } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { createReadStream } from 'node:fs';
import { ConfigSource, type HasObjectId } from '@growi/core';
import type { IUser, IUserHasId } from '@growi/core/dist/interfaces';
// biome-ignore lint/style/noRestrictedImports: TODO: check effects of using custom axios
import rawAxios, { type AxiosRequestConfig } from 'axios';
import * as FormDataModule from 'form-data';
import mongoose, { Types as MongooseTypes } from 'mongoose';
import { basename } from 'pathe';

import {
  type AdminRescueOutcome,
  G2G_PROGRESS_STATUS,
  type G2GProgressStatus,
  type RescuedAdminSummary,
  type TransferPreflightResult,
} from '~/interfaces/g2g-transfer';
import { COLLECTIONS_EXCLUDED_FROM_COHERENCE } from '~/models/admin/g2g-transfer-preset';
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
import { AccessToken, type IAccessToken } from '../models/access-token';
import { Attachment } from '../models/attachment';
import UserGroup from '../models/user-group';
import {
  G2G_CONFLICT_DETECTION_FAILED_ERROR_CODE,
  G2G_DATA_CONFLICT_ERROR_CODE,
  G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
  G2G_IMPORT_SETTINGS_INVALID_ERROR_CODE,
  G2G_INVALID_TRANSFER_KEY_ERROR_CODE,
  G2G_MIXED_IMPORT_MODES_ERROR_CODE,
  G2G_MONGO_COLLECTION_IMPORT_FAILURE_ERROR_CODE,
  G2G_PARSE_FAILED_ERROR_CODE,
  G2G_PROTECTED_COLLECTION_ERROR_CODE,
  G2G_VALIDATION_FAILED_ERROR_CODE,
  G2G_VERSION_INCOMPATIBLE_ERROR_CODE,
  G2GTransferError,
  G2GTransferErrorCode,
} from '../models/vo/g2g-transfer-error';
import { configManager } from './config-manager';
import type { ConfigKey } from './config-manager/config-definition';
import { exportService } from './export';
import {
  canSelectSessions,
  invalidateSessionsExcept,
  resolveSessionAccess,
} from './g2g-transfer-session-invalidation';
import {
  describeBlocker,
  evaluateTransferability,
  type TransferabilityReport,
  type TransferBlocker,
} from './g2g-transfer-transferability';
import {
  detectUniqueConflicts,
  readArchiveUserIdentity,
  type UniqueConflictReport,
} from './import/detect-unique-conflicts';
import { generateOverwriteParams } from './import/overwrite-params';
import { deriveReplaceTargets } from './import/replace-target-collections';
import {
  type AdminRescuePlan,
  isLoginable,
  planAdminRescue,
} from './import/rescue-admins';

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
 * Settings that belong to the destination as an installation rather than to the wiki it
 * holds, and are therefore put back after every import — whatever the transfer replaced
 * (requirement 5.4).
 *
 * Kept apart from {@link UPLOAD_CONFIG_KEYS} on purpose. That restoration is wrapped in a
 * condition of its own (`app:fileUploadType !== 'none'`, i.e. "this GROWI already has
 * storage configured"), which has nothing to say about the site URL; folding these keys
 * into it would hand the destination the source's address on any GROWI that stores no
 * files.
 */
const DESTINATION_OWNED_CONFIG_KEYS = ['app:siteUrl'] satisfies ConfigKey[];

type DestinationOwnedConfigs = {
  [key in (typeof DESTINATION_OWNED_CONFIG_KEYS)[number]]: any;
};

/** The collection whose replacement means the destination loses its own accounts. */
const USERS_COLLECTION_NAME = 'users';

/**
 * The collection whose replacement means the destination is now running on the archive's
 * settings — the reason it stays closed until the operator opens it (requirement 2.9).
 */
const CONFIGS_COLLECTION_NAME = 'configs';

/**
 * Data used for comparing to/from GROWI information
 *
 * This is everything the source is ever told about the destination, and the whole input
 * to the transferability judgement (`evaluateTransferability`, which this type satisfies
 * structurally). It carries counts, a fingerprint and flags — never a user name, an
 * address or a secret (requirement 3.6 and the Security Considerations of design.md).
 */
export type IDataGROWIInfo = {
  /** GROWI version */
  version: string;
  /** Max user count */
  userUpperLimit: number | null; // Handle null as Infinity
  /** Total file size allowed */
  fileUploadTotalLimit: number | null; // Handle null as Infinity
  /**
   * How much of the destination a migration transfer would delete, so the operator sees
   * it before the archive is built (requirement 3.1). Counts only — the operator is being
   * shown a size, not the contents.
   */
  destinationCounts: {
    users: number;
    userGroups: number;
    pages: number;
  };
  /** One-way hash of this GROWI's password seed; see {@link computePasswordSeedFingerprint}. */
  passwordSeedFingerprint: string;
  /**
   * Administrators who are active *and* have a password hash, i.e. the accounts the
   * rescue would keep able to log in. Reported as "how many can", not "how many cannot",
   * so `=== 0` answers requirement 3.5 exactly: an administrator being suspended is not
   * by itself a reason to warn while others can still get in.
   */
  loginableAdminCount: number;
  /**
   * Whether the sessions of replaced users can actually be invalidated here
   * (requirement 3.7). Decided by the same resolution that later performs the
   * invalidation — see `g2g-transfer-session-invalidation.ts`.
   */
  sessionStoreSupportsEnumeration: boolean;
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
 * One-way fingerprint of a password seed, for the two GROWIs to compare theirs without
 * either of them learning the other's (requirement 3.6).
 *
 * The seed is what every password hash on a GROWI is derived from (`generatePassword` in
 * `models/user/index.js` hashes `PASSWORD_SEED + password`), so it must not travel; what
 * the source needs is only whether the destination's differs from its own, which would
 * mean the migrated users cannot log in with the passwords they had.
 *
 * A GROWI started without `PASSWORD_SEED` is fingerprinted like any other value rather
 * than treated as "unknown": the hashing above concatenates the seed as-is, so two such
 * GROWIs really do share their users' hashes, and one with a seed really does not.
 */
export const computePasswordSeedFingerprint = (
  seed: string | undefined,
): string => createHash('sha256').update(String(seed)).digest('hex');

/**
 * Return type for {@link Pusher.getTransferability}
 */
export type Transferability =
  | { canTransfer: true }
  | { canTransfer: false; reason: string };

/**
 * Maps a blocker list to `getTransferability`'s existing return shape: proceed if
 * there are none, otherwise stop with the first one's message.
 *
 * Pure, and exported for the same reason {@link toArchivePostErrorEvent} is: so
 * `getTransferability` itself reduces to gathering the inputs and calling this, and the
 * "which blocker wins, what does the caller see" behavior is unit-testable without a
 * database. `describeBlocker` stays the only place that turns a blocker into text
 * (see g2g-transfer-transferability.ts), so this function never builds a message itself.
 *
 * Takes the blocker list directly, not a `TransferabilityReport` — there is no warning
 * to fold in here (this pre-existing check has no room for one in its return shape;
 * surfacing warnings to the operator is the preflight endpoint's job, task 8.2), so
 * there is nothing to gain and a fabricated `warnings: []` to avoid by requiring one.
 */
export const toTransferability = (
  blockers: readonly TransferBlocker[],
): Transferability => {
  const [firstBlocker] = blockers;
  return firstBlocker == null
    ? { canTransfer: true }
    : { canTransfer: false, reason: describeBlocker(firstBlocker) };
};

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
   * Inspects the destination and reports what a migration transfer would delete and
   * warn about, without starting one (requirements 3.1, 3.3, 3.4, 3.5, 3.7). Performs
   * no writes of its own anywhere: it reads this GROWI's own state, then asks the
   * destination for its `growi-info` answer, which is likewise a read on that side.
   * @param {TransferKey} tk Transfer key
   */
  preflight(tk: TransferKey): Promise<TransferPreflightResult>;
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
 * Projects a re-insertion payload down to {@link RescuedAdminSummary}, dropping the
 * password hash, `apiToken` and access-token `tokenHash` values `AdminRescuePlan`
 * carries for re-insertion. The operator is already shown how many administrators can
 * log in *before* the transfer starts (`loginableAdminCount`, requirement 3.5), so this
 * projection has no reason to name the administrators the rescue chose not to keep,
 * either.
 */
const toRescueOutcome = (plan: AdminRescuePlan): AdminRescueOutcome => ({
  // Field by field rather than by removing the secrets from a spread: a field added to
  // `RescuedAdmin` later is then absent here until someone decides it may cross, instead
  // of travelling the moment it exists.
  rescued: plan.rescued.map((rescued) => ({
    originalUsername: rescued.originalUsername,
    rescuedUsername: rescued.rescuedUsername,
    emailRemoved: rescued.emailRemoved,
    slackMemberIdRemoved: rescued.slackMemberIdRemoved,
    idReassigned: rescued.idReassigned,
  })),
});

/**
 * The outcome of one received transfer, as far as the source is concerned.
 *
 * Every field exists because the source cannot see any of it otherwise: the two GROWIs are
 * separate processes, and the progress the operator watches is emitted by the source's.
 */
export interface ImportCollectionsResult extends ImportResult {
  /**
   * Whether the import threw instead of returning.
   *
   * `failedCollections` cannot express this: an import that threw hands back no list at
   * all, so an empty one would read as "every collection arrived". The source needs the
   * difference — it is what turns a successful answer (which it must be, or the
   * attachments never cross) into a reported failure rather than a green success
   * (requirements 2.5, 5.2).
   */
  readonly importAborted: boolean;
  /**
   * Null when this transfer did not replace the destination's accounts. When it did
   * but the re-insertion failed (`rescueApplied: false`), this is `{ rescued: [] }`,
   * never the plan's list — the plan is what this GROWI *tried* to write back, not
   * what actually landed, and a caller that only reads `rescue` (without checking
   * `rescueApplied`) must not be told about accounts that are not really there.
   */
  readonly rescue: AdminRescueOutcome | null;
  /** Whether the rescue was actually written back. False leaves the destination closed. */
  readonly rescueApplied: boolean;
  /** Labels of the clean-up steps that failed. The response stays a success regardless. */
  readonly postProcessFailures: readonly string[];
  readonly maintenanceModeReleased: boolean;
}

/**
 * Whether this import has to close the destination while it runs (requirement 2.4).
 *
 * The set is taken minus the collections whose import method the system, not the operator,
 * constrains ({@link COLLECTIONS_EXCLUDED_FROM_COHERENCE} — the same declaration the
 * coherence judgement reads, so there is one answer to "did the operator ask for a
 * replacement?"). Without that subtraction every transfer would qualify: `configs` is
 * forced to be replaced, so an ordinary merge transfer would put the destination into
 * maintenance mode, and `pages` may be replaced in a merge transfer too — both are
 * behavior changes requirement 6.1 forbids.
 */
const shouldEnterMaintenanceMode = (
  replaceTargetCollections: ReadonlySet<string>,
): boolean =>
  [...replaceTargetCollections].some(
    (collectionName) =>
      !COLLECTIONS_EXCLUDED_FROM_COHERENCE.has(collectionName),
  );

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
   * Import collections, together with everything that has to happen around the import for
   * a transfer that replaces this GROWI's data.
   * @param {string} collections Array of collection name
   * @param {{ [key: string]: ImportSettings; }} importSettingsMap Map of collection name and ImportSettings
   * @param {FileUploadConfigs} sourceGROWIUploadConfigs File upload configs from src GROWI
   */
  importCollections(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
    sourceGROWIUploadConfigs: FileUploadConfigs,
  ): Promise<ImportCollectionsResult>;
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
  // The push route drops non-transferable collections before the archive is built, so a
  // transfer started from the admin screen never gets this answer. When it does arrive,
  // the two GROWIs disagree about which collections a transfer may carry, and the generic
  // "failed to send the archive" hides exactly the fact that identifies that: the
  // receiver's message names the collections it refused.
  [G2G_PROTECTED_COLLECTION_ERROR_CODE, 'admin:g2g:error_protected_collection'],
  // The push route builds a plan that is always coherent (task 10.1 narrowed the legacy
  // screen so it can no longer assign replace to some collections and append to others),
  // so a normal transfer never gets this answer either. When it does, the request reached
  // the receive route by another path entirely (an automation script, or a modified
  // client), and the generic "failed to send the archive" would hide the one fact that
  // explains it: the two GROWIs disagree about whether this request's import-method
  // assignment is even allowed.
  [G2G_MIXED_IMPORT_MODES_ERROR_CODE, 'admin:g2g:error_mixed_import_methods'],
  [G2G_INVALID_TRANSFER_KEY_ERROR_CODE, 'admin:g2g:error_invalid_transfer_key'],
  [G2G_PARSE_FAILED_ERROR_CODE, 'admin:g2g:error_parse_failed'],
  [G2G_VALIDATION_FAILED_ERROR_CODE, 'admin:g2g:error_validation_failed'],
  [G2G_VERSION_INCOMPATIBLE_ERROR_CODE, 'admin:g2g:error_version_incompatible'],
  [
    G2G_IMPORT_SETTINGS_INVALID_ERROR_CODE,
    'admin:g2g:error_import_settings_invalid',
  ],
  // Distinguishes "the receive route ran and refused to guess whether the archive
  // conflicts" from a plain network failure, which used to fall back to the same
  // generic "failed to send the archive" event as a dropped connection.
  [
    G2G_CONFLICT_DETECTION_FAILED_ERROR_CODE,
    'admin:g2g:error_conflict_detection_failed',
  ],
  [
    G2G_MONGO_COLLECTION_IMPORT_FAILURE_ERROR_CODE,
    'admin:g2g:error_mongo_collection_import_failure',
  ],
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
 * Reads whether the destination's import threw instead of finishing.
 *
 * A separate fact from {@link readFailedCollections}, and not derivable from it: an import
 * that threw names no collection, so its `failedCollections` is empty and looks exactly
 * like a transfer where everything arrived. Guarded the same way — an older destination
 * answers without the field, which reads as "the import ran to the end", the only thing
 * this code could assume before the field existed.
 */
export const readImportAborted = (responseData: unknown): boolean =>
  isRecord(responseData) && responseData.importAborted === true;

/**
 * Whether `value` has every field {@link RescuedAdminSummary} promises, checked
 * field-by-field rather than trusted from a type assertion: this is a network boundary,
 * so a malformed entry must be dropped instead of reaching the operator's browser as a
 * summary with `undefined` fields.
 */
const isRescuedAdminSummary = (value: unknown): value is RescuedAdminSummary =>
  isRecord(value) &&
  typeof value.originalUsername === 'string' &&
  typeof value.rescuedUsername === 'string' &&
  typeof value.emailRemoved === 'boolean' &&
  typeof value.slackMemberIdRemoved === 'boolean' &&
  typeof value.idReassigned === 'boolean';

/**
 * Reads the rescue outcome out of the destination's response to the archive.
 *
 * Guarded the whole way down, like {@link readFailedCollections} and
 * {@link readImportAborted}: this is a network boundary, an older destination answers
 * without the field at all, a transfer that never replaced `users` answers with
 * `rescue: null` (see `ImportCollectionsResult.rescue`), and a proxy can replace the
 * body with something else entirely. Anything unrecognized reads as "nothing to report",
 * which is what this code would have to assume before the field existed.
 *
 * Each surviving entry is rebuilt field-by-field after the guard passes, the mirror of
 * {@link toRescueOutcome} on the writing side: `isRescuedAdminSummary` only proves the
 * five fields it checks are *present*, it does not prove they are the *only* ones. A
 * destination that attached an extra field to an entry -- whether malicious or just a
 * future field this code does not know about yet -- would otherwise ride the original
 * object through untouched and reach the source operator's browser over the
 * `admin:g2gProgress` socket event.
 */
export const readRescueOutcome = (
  responseData: unknown,
): AdminRescueOutcome | null => {
  if (!isRecord(responseData) || !isRecord(responseData.rescue)) {
    return null;
  }

  const { rescued } = responseData.rescue;

  return Array.isArray(rescued)
    ? {
        rescued: rescued.filter(isRescuedAdminSummary).map((entry) => ({
          originalUsername: entry.originalUsername,
          rescuedUsername: entry.rescuedUsername,
          emailRemoved: entry.emailRemoved,
          slackMemberIdRemoved: entry.slackMemberIdRemoved,
          idReassigned: entry.idReassigned,
        })),
      }
    : null;
};

/**
 * Reads whether a rescue that was planned actually got written back to the
 * destination, out of its response to the archive.
 *
 * Guarded like the readers above: an older destination answers without the field,
 * which reads as "applied" — the best case, and what every destination effectively
 * reported before this field existed.
 *
 * On its own this cannot tell a legacy transfer that never needed a rescue (also
 * answers `rescueApplied: false`, since the flag simply never gets set to `true`
 * for it — see `ImportCollectionsResult`) apart from a migration whose rescue
 * genuinely failed to write back. A caller must combine it with
 * {@link readRescueOutcome} being non-null, which is only true when a rescue was
 * actually planned.
 */
export const readRescueApplied = (responseData: unknown): boolean =>
  !isRecord(responseData) || responseData.rescueApplied !== false;

/**
 * Reads the labels of the destination's clean-up steps that failed, out of its
 * response to the archive.
 *
 * Guarded like {@link readFailedCollections}: an older destination answers without
 * the field, which reads as "nothing failed" — the only thing this code could
 * assume before the field existed. A failed clean-up step (restoring the upload
 * configs, the destination-owned configs, or invalidating sessions) leaves the
 * destination silently wrong in ways requirements 5.3, 5.4 and 5.5 do not allow, so
 * the source must not read a response carrying one of these as a plain success.
 */
export const readPostProcessFailures = (
  responseData: unknown,
): readonly string[] => {
  if (!isRecord(responseData)) {
    return [];
  }

  const { postProcessFailures } = responseData;

  return Array.isArray(postProcessFailures)
    ? postProcessFailures.filter(
        (label): label is string => typeof label === 'string',
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

  /**
   * Gathers this GROWI's own state and judges it against `destGROWIInfo`. Shared by
   * {@link getTransferability} (the execution-time re-check the `/transfer` route runs
   * right before calling `startTransfer`) and {@link preflight} (the read-only report
   * requirement 3.1 shows the operator before they confirm), so the two never drift
   * into computing "can this transfer proceed" two different ways — task 10.2's
   * non-negotiable is exactly that the execution-time check reuses this judgement
   * rather than re-implementing a blockers-only version of it.
   */
  private async evaluateAgainstDestination(
    destGROWIInfo: IDataGROWIInfo,
  ): Promise<TransferabilityReport> {
    const { fileUploadService, passportService } = this.crowi;
    const User = mongoose.model<IUser, any>('User');

    const [activeUsers, totalFileSize] = await Promise.all([
      User.countActiveUsers(),
      fileUploadService.getTotalFileSize(),
    ]);

    // `isLocalAuthEnabled` is read from this GROWI's own passport service rather than
    // assumed true/false: the `local_auth_disabled_at_source` warning exists precisely
    // because the source's own local-auth setting decides whether a rescued
    // destination administrator can still use a password (requirement 3.7).
    return evaluateTransferability(
      {
        version: getGrowiVersion(),
        activeUsers,
        totalFileSize,
        fileUploadType: configManager.getConfig('app:fileUploadType'),
        passwordSeedFingerprint: computePasswordSeedFingerprint(
          this.crowi.env.PASSWORD_SEED,
        ),
        isLocalAuthEnabled: passportService.isLocalStrategySetup,
      },
      destGROWIInfo,
    );
  }

  public async getTransferability(
    destGROWIInfo: IDataGROWIInfo,
  ): Promise<Transferability> {
    // `evaluateAgainstDestination` (which runs the full `evaluateTransferability`),
    // not a blockers-only computation: a confirmation the operator gave a minute ago,
    // looking at a `preflight` report, must not let a transfer start against a
    // destination that has since drifted into a blocked state (requirement 3.2's
    // server-side counterpart). Only `blockers` matters for this method's return
    // shape — the warnings have already been shown to and acknowledged by the operator
    // by the time the `/transfer` route calls this.
    const { blockers } = await this.evaluateAgainstDestination(destGROWIInfo);
    return toTransferability(blockers);
  }

  public async preflight(tk: TransferKey): Promise<TransferPreflightResult> {
    const destGROWIInfo = await this.askGROWIInfo(tk);

    const { blockers, warnings } =
      await this.evaluateAgainstDestination(destGROWIInfo);

    return {
      destinationCounts: destGROWIInfo.destinationCounts,
      blockers,
      warnings,
    };
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

    // A 200 only means the destination answered. What became of the import is in the body,
    // and this is the only place that fact can be read: the two GROWIs are separate
    // processes and these notifications are emitted by this one.
    const failedCollections = readFailedCollections(archiveResponseData);
    // Two ways the destination can be left incomplete, and it reports them separately
    // because an import that threw can name no collection at all. Both mean the same thing
    // to the operator: the destination is not finished and is still in maintenance mode.
    const importAborted = readImportAborted(archiveResponseData);
    // Present only when this transfer replaced `users` and a rescue was planned
    // (requirement 4.1) — read from the same response body, for the same reason as
    // the two facts above: this is the only channel it can cross on. Non-null here
    // means "a rescue was planned", not "it succeeded" — see `readRescueApplied`.
    const rescueOutcome = readRescueOutcome(archiveResponseData);
    const rescueApplied = readRescueApplied(archiveResponseData);
    // A rescue that was planned but never written back leaves the destination with
    // nobody able to log in as the administrator it was counting on, which is not a
    // successful transfer even though the collections themselves all imported.
    // `rescueApplied` alone cannot say this: an ordinary merge transfer that never
    // needed a rescue also answers `rescueApplied: false` (it is simply never set to
    // `true`), so this only means "the rescue failed" once combined with `rescueOutcome`
    // being non-null -- i.e. a rescue was actually planned in the first place.
    const rescueFailed = rescueOutcome != null && !rescueApplied;
    // Failed clean-up steps (restoring the upload configs, the destination-owned
    // configs, or invalidating sessions) leave the destination silently wrong
    // (requirements 5.3, 5.4, 5.5) with nothing in the response to say so unless this
    // is read: the receive route answers 200 regardless (design.md's Error Strategy),
    // so a caller that ignores this list sees the same success as a clean transfer.
    const postProcessFailures = readPostProcessFailures(archiveResponseData);
    const isImportIncomplete =
      failedCollections.length > 0 ||
      importAborted ||
      rescueFailed ||
      postProcessFailures.length > 0;

    if (isImportIncomplete) {
      logger.error(
        {
          failedCollections,
          importAborted,
          rescueFailed,
          postProcessFailures,
        },
        'The destination GROWI did not finish importing the transfer data',
      );
    }

    // The status the mongo phase keeps for the rest of the transfer. An import that did
    // not finish is never restated as COMPLETED later on: the admin screen reads
    // `mongo === COMPLETED && attachments === COMPLETED` as "the transfer succeeded" and
    // shows the green toast, so restating it would hand the operator a success for a
    // transfer that lost collections (requirements 2.5, 2.8).
    const mongoStatus: G2GProgressStatus = isImportIncomplete
      ? G2G_PROGRESS_STATUS.ERROR
      : G2G_PROGRESS_STATUS.COMPLETED;

    const emitProgress = (attachments: G2GProgressStatus): void => {
      socket?.emit('admin:g2gProgress', {
        mongo: mongoStatus,
        attachments,
        // Only carried when there is something to carry, so a fully successful transfer
        // keeps emitting exactly the payload it did before, and an import that threw —
        // which names no collection — does not claim an empty list of casualties.
        ...(failedCollections.length > 0 ? { failedCollections } : {}),
        // Same reasoning as `failedCollections`: a transfer that never replaced `users`
        // (rescueOutcome === null) or rescued nobody (an empty list — every administrator
        // kept its own account) keeps emitting exactly the payload it did before this
        // field existed, rather than claiming a rescue that has nothing in it.
        //
        // `rescueApplied` is checked here too, not only folded into `isImportIncomplete`
        // above: this is a network boundary, and the receiving side already nulling out
        // the names on a failed rescue (`ImportCollectionsResult.rescue`) must not be the
        // only thing standing between a stale/out-of-sync destination and naming accounts
        // that are not really there. Nothing is carried unless both fields agree the
        // rescue actually landed.
        ...(rescueOutcome != null &&
        rescueApplied &&
        rescueOutcome.rescued.length > 0
          ? { rescue: rescueOutcome }
          : {}),
      });
    };

    /**
     * Tells the operator that the transfer did not fully succeed, naming the collections
     * that were left out when the destination could name them.
     *
     * Deferred until the attachments are done rather than emitted here, because the
     * client hides the progress panel as soon as an `admin:g2gError` arrives: emitting it
     * now would replace a live view of the attachment transfer with silence for as long
     * as the files take. Until then the panel already shows the mongo phase in error, so
     * the failure is visible the whole time; this event is the closing word on it.
     */
    const reportIncompleteImport = (): void => {
      socket?.emit('admin:g2gError', {
        key: 'admin:g2g:error_partial_import',
        message:
          failedCollections.length > 0
            ? `Collections that could not be imported: ${failedCollections.join(', ')}`
            : 'The destination GROWI could not finish importing the transfer data, and is left in maintenance mode.',
      });
    };

    emitProgress(G2G_PROGRESS_STATUS.IN_PROGRESS);

    // The attachments are transferred even when the import was only partly successful.
    // The destination keeps everything it did import — `users` among it — so the unique
    // conflict gate refuses a plain retry of the whole transfer with a 409, and skipping
    // the files here would leave the operator with no way to get them across short of
    // rebuilding the destination. Requirement 5.2 asks for the attachments not to be
    // lost; requirement 2.8 asks for the failure to be reported, and both are satisfied
    // by sending the files and still reporting the failure below.
    try {
      await this.transferAttachments(tk);
    } catch (err) {
      logger.error(err);
      emitProgress(G2G_PROGRESS_STATUS.ERROR);
      socket?.emit('admin:g2gError', {
        message: 'Failed to transfer attachments',
        key: 'admin:g2g:error_upload_attachment',
      });
      // A failed attachment transfer does not take the place of the import failure: they
      // are separate facts, and only this event says the destination's own data is
      // incomplete.
      if (isImportIncomplete) {
        reportIncompleteImport();
      }
      throw err;
    }

    emitProgress(G2G_PROGRESS_STATUS.COMPLETED);

    if (isImportIncomplete) {
      reportIncompleteImport();
    }
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

  /**
   * How much data a migration transfer would delete from this GROWI (requirement 3.1).
   */
  private async countDestinationData(): Promise<
    IDataGROWIInfo['destinationCounts']
  > {
    const User = mongoose.model<IUser, any>('User');
    const Page = mongoose.model('Page');

    const [users, userGroups, pages] = await Promise.all([
      User.countDocuments(),
      UserGroup.countDocuments(),
      Page.countDocuments(),
    ]);

    return { users, userGroups, pages };
  }

  /**
   * How many administrators would still be able to log in here (requirement 3.5).
   *
   * `findAdmins()` returns the administrators in an active status, and `isLoginable` —
   * the rescue's own rule, imported rather than restated — keeps those that also have a
   * password hash. A destination whose administrators all sign in through an external
   * account therefore reports none, which is the case requirement 3.5 exists for.
   */
  private async countLoginableAdmins(): Promise<number> {
    const User = mongoose.model<IUser, any>('User');

    const admins: readonly Pick<IUserHasId, 'status' | 'password'>[] =
      await User.findAdmins();

    return admins.filter(isLoginable).length;
  }

  public async answerGROWIInfo(): Promise<IDataGROWIInfo> {
    const { fileUploadService } = this.crowi;
    const version = getGrowiVersion();
    const userUpperLimit = configManager.getConfig('security:userUpperLimit');
    const fileUploadTotalLimit = fileUploadService.getFileUploadTotalLimit();
    const isWritable = await fileUploadService.isWritable();

    const [destinationCounts, loginableAdminCount, sessionAccess] =
      await Promise.all([
        this.countDestinationData(),
        this.countLoginableAdmins(),
        // The same resolution the invalidation itself runs on, so this GROWI cannot
        // announce a capability it has no means to deliver (requirement 3.7).
        // `sessionConfig` is assigned while the server boots; a receiver that has none
        // reports "cannot select sessions", which warns the operator rather than
        // promising something.
        resolveSessionAccess(this.crowi.sessionConfig?.store),
      ]);

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
      fileUploadTotalLimit,
      version,
      attachmentInfo,
      destinationCounts,
      passwordSeedFingerprint: computePasswordSeedFingerprint(
        this.crowi.env.PASSWORD_SEED,
      ),
      loginableAdminCount,
      sessionStoreSupportsEnumeration: canSelectSessions(sessionAccess),
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

  /**
   * Takes a copy of this GROWI's administrators, and of the access tokens they issued,
   * before the import removes them.
   *
   * Read with `lean()`, never through a document's `toObject()`: the users schema runs
   * `omitInsecureAttributes` in its transform, which drops `password` and `apiToken`
   * (`models/user/index.js`) — and `IUser.password` is declared as a required string, so
   * nothing would complain until the rescued administrator turned out to have no password
   * to log in with. The access tokens are read with a projection of their own for the same
   * reason: `findTokenByUserId` selects neither `tokenHash` nor `user`, which are exactly
   * the two fields the re-insertion cannot do without.
   *
   * Every administrator is read, not only the ones that can log in: `planAdminRescue`
   * is what decides which of them are worth rescuing.
   */
  private async planDestinationAdminRescue(
    importSettingsMap: Map<string, ImportSettings>,
  ): Promise<AdminRescuePlan> {
    const importService = getImportService();
    const User = mongoose.model<IUser, any>('User');

    // The very settings the import is about to run on, so the identity is read from the
    // file whose documents will actually be written.
    const usersJsonFileName = importSettingsMap.get(
      USERS_COLLECTION_NAME,
    )?.jsonFileName;
    if (usersJsonFileName == null) {
      throw new Error(
        'The archive carries no users.json although `users` is being replaced',
      );
    }

    const admins: IUserHasId[] = await User.find({ admin: true }).lean();
    const accessTokens = await AccessToken.find({
      user: { $in: admins.map((admin) => admin._id) },
    })
      .select('user tokenHash expiredAt scopes description')
      .lean<(IAccessToken & HasObjectId)[]>();

    const archiveIdentity = await readArchiveUserIdentity(
      importService.getFile(usersJsonFileName),
    );

    return planAdminRescue(admins, accessTokens, archiveIdentity);
  }

  /**
   * Writes the rescued administrators and their access tokens back.
   *
   * Through the Mongoose models rather than the raw driver the import itself uses: the
   * schema validations and the unique indexes are the only thing that can tell us the
   * renamed `username` and the dropped `email` really are collision-free. A rescue that
   * failed silently would leave a destination nobody can log into while reporting success.
   *
   * The accounts go back before their tokens, so the administrator is restored first and
   * the tokens are the part that can still fail. One way it does: a transfer that replaces
   * `users` while leaving `accesstokens` out of its collections never emptied that
   * collection, so the tokens saved here are still in it and `create` fails on the
   * duplicate `_id`. `rescueApplied` is then reported false — the administrator *was*
   * rescued and can log in, but the destination is kept closed anyway. That is the error
   * in the safe direction: the operator is asked to look at a destination that is fine,
   * rather than handed a destination whose rescue silently half-landed. The migration
   * preset always carries `accesstokens`, so this is not the ordinary path.
   */
  private async applyAdminRescue(plan: AdminRescuePlan): Promise<void> {
    const User = mongoose.model<IUser, any>('User');

    await User.create(plan.rescued.map((rescued) => rescued.user));

    const accessTokens = plan.rescued.flatMap((rescued) => [
      ...rescued.accessTokens,
    ]);
    if (accessTokens.length > 0) {
      await AccessToken.create(accessTokens);
    }
  }

  /** The destination's own installation settings, as they stand right now. */
  private async getDestinationOwnedConfigs(): Promise<DestinationOwnedConfigs> {
    return Object.fromEntries(
      DESTINATION_OWNED_CONFIG_KEYS.map((key) => [
        key,
        configManager.getConfig(key, ConfigSource.db),
      ]),
    ) as DestinationOwnedConfigs;
  }

  /**
   * Runs the import and everything that has to happen around it when a transfer replaces
   * this GROWI's data.
   *
   * Three concerns start on three different conditions, and running them off one would
   * break a different requirement each time (see design.md, ReceiverService):
   *
   * - **closing the destination** — when the operator asked for a replacement at all;
   * - **rescuing the administrators** — only when `users` is among the replaced
   *   collections. On the wider condition, a merge transfer that replaces only `pages`
   *   would try to re-insert administrators that were never removed, fail on every one of
   *   them, and report a successful transfer as failed;
   * - **putting the destination's own settings back** — always, exactly as before.
   *
   * The import call is wrapped in `try`/`catch`/`finally` so that the rescue happens even
   * when the import throws: `import()` swallows a single collection's failure but not the
   * page normalization that follows the loop, so "the import returned" cannot be relied on
   * (requirement 4.8). An import that threw is still answered as a success, carrying
   * `importAborted`, because the source will not transfer a single attachment otherwise
   * (requirement 5.2 outranks 2.8 here). Nothing in the `finally` may fail this call for
   * the same reason, so each step is caught and reported instead.
   */
  public async importCollections(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
    sourceGROWIUploadConfigs: FileUploadConfigs,
  ): Promise<ImportCollectionsResult> {
    const { appService } = this.crowi;
    const importService = getImportService();

    const replaceTargetCollections = deriveReplaceTargets(importSettingsMap);
    const shouldProtect = shouldEnterMaintenanceMode(replaceTargetCollections);
    const shouldRescueAdmins = replaceTargetCollections.has(
      USERS_COLLECTION_NAME,
    );

    // Read before the flag is raised, so that the clean-up restores what this GROWI was
    // rather than switching maintenance mode off (requirement 6.1): a destination its own
    // administrator had closed before the transfer must not be opened by it.
    const maintenanceModeBeforeTransfer = appService.isMaintenanceMode();

    const destinationOwnedConfigs = await this.getDestinationOwnedConfigs();
    /** whether to keep current file upload configs */
    const shouldKeepUploadConfigs =
      configManager.getConfig('app:fileUploadType') !== 'none';
    const fileUploadConfigs = shouldKeepUploadConfigs
      ? await this.getFileUploadConfigs()
      : null;

    const rescuePlan = shouldRescueAdmins
      ? await this.planDestinationAdminRescue(importSettingsMap)
      : null;

    if (shouldProtect) {
      await appService.startMaintenanceMode();
      logger.info(
        { wasAlreadyInMaintenanceMode: maintenanceModeBeforeTransfer },
        'Started maintenance mode for the transfer import',
      );
    }

    const postProcessFailures: string[] = [];
    const runPostProcess = async (
      label: string,
      step: () => Promise<void>,
    ): Promise<void> => {
      try {
        await step();
      } catch (err) {
        // Deliberately says nothing about how much of the step got done: a session
        // invalidation that throws half way loses the count of what it had already
        // destroyed along with the exception, so a message shaped around one would
        // report "0 sessions destroyed" for a step that destroyed hundreds.
        logger.error(
          { err, step: label },
          'A step of the transfer clean-up failed. The transfer itself is still reported as successful, so that the source can go on to transfer the attachments',
        );
        postProcessFailures.push(label);
      }
    };

    let importResult: ImportResult | null = null;
    let rescueApplied = false;
    let maintenanceModeReleased = false;

    try {
      importResult = await importService.import(collections, importSettingsMap);
    } catch (err) {
      // Caught rather than propagated: the route answers this as a success so the source
      // goes on to the attachments, and `importAborted` in the result is what stops that
      // success from reading as a complete transfer. `importResult` stays null, which
      // every decision below already treats as "nothing can vouch for this import".
      logger.error(
        { err },
        'The transfer import did not finish. The destination is left in maintenance mode and the source is told the transfer failed',
      );
    } finally {
      if (rescuePlan != null) {
        await runPostProcess('reinsert-rescued-admins', async () => {
          await this.applyAdminRescue(rescuePlan);
          rescueApplied = true;

          // Counts and the renamed usernames only -- never the password hash, `apiToken`
          // or access-token `tokenHash` values `AdminRescuePlan` carries for re-insertion
          // (design.md's Monitoring section; see also `toRescueOutcome`'s doc comment).
          const renamedUsernames = rescuePlan.rescued
            .filter(
              (rescued) => rescued.originalUsername !== rescued.rescuedUsername,
            )
            .map((rescued) => ({
              from: rescued.originalUsername,
              to: rescued.rescuedUsername,
            }));
          logger.info(
            {
              rescuedCount: rescuePlan.rescued.length,
              renamedUsernames,
              idReassignedCount: rescuePlan.rescued.filter(
                (rescued) => rescued.idReassigned,
              ).length,
              reinsertedAccessTokenCount: rescuePlan.rescued.reduce(
                (sum, rescued) => sum + rescued.accessTokens.length,
                0,
              ),
            },
            'Rescued destination administrators before the transfer import replaced them',
          );
        });

        await runPostProcess('invalidate-sessions', async () => {
          // The sessions of the accounts that were just replaced now point at users that
          // no longer exist; the rescued administrators keep theirs (requirements 5.5,
          // 4.3). The identifiers are handed over as they were read — `invalidateSessionsExcept`
          // normalises `ObjectId` and string alike, so a `lean()` read cannot silently
          // match nothing.
          //
          // The counts it returns are not carried any further: they are logged by that
          // function, and what the operator needed to know — that this destination cannot
          // single out sessions at all — was already reported to them as a warning before
          // the transfer started (requirement 3.7).
          const sessionAccess = await resolveSessionAccess(
            this.crowi.sessionConfig?.store,
          );
          await invalidateSessionsExcept(
            sessionAccess,
            rescuePlan.rescued.map((rescued) => rescued.user._id),
          );
        });
      }

      // Unconditional, as it has always been: whether this GROWI keeps its own storage
      // settings has nothing to do with which collections the transfer replaced.
      await runPostProcess('restore-upload-configs', async () => {
        if (fileUploadConfigs != null) {
          // restore file upload config from cache
          await configManager.removeConfigs(UPLOAD_CONFIG_KEYS);
          await configManager.updateConfigs(fileUploadConfigs);
        } else {
          // update file upload config
          await configManager.updateConfigs(sourceGROWIUploadConfigs);
        }
      });

      // A separate step, not another branch of the one above: this GROWI keeps its own
      // address whatever its storage is configured to be (requirement 5.4). The source's
      // maintenance-mode value is never among these keys — that flag is decided here.
      await runPostProcess('restore-destination-owned-configs', async () => {
        await configManager.updateConfigs(destinationOwnedConfigs, {
          // The destination may have had no row of its own (the value coming from the
          // environment); leaving the archive's row behind would override it.
          removeIfUndefined: true,
        });
      });

      await runPostProcess('set-up-file-upload', async () => {
        await this.crowi.setUpFileUpload(true);
        await appService.setupAfterInstall();
      });

      // An import that threw hands back no list of failed collections, so there is nothing
      // to conclude "everything arrived" from — it counts as a failure.
      const importFailed =
        importResult == null || importResult.failedCollections.length > 0;
      const rescueFailed = rescuePlan != null && !rescueApplied;
      // Replacing `configs` leaves this GROWI running on the archive's settings and, for a
      // transfer, with not one attachment delivered yet. It stays closed until the operator
      // opens it, which they were told before the transfer started (requirements 2.9, 2.10).
      const settingsWereReplaced = replaceTargetCollections.has(
        CONFIGS_COLLECTION_NAME,
      );

      if (shouldProtect) {
        if (importFailed || rescueFailed || settingsWereReplaced) {
          logger.warn(
            {
              failedCollections: importResult?.failedCollections,
              importThrew: importResult == null,
              rescueFailed,
              settingsWereReplaced,
            },
            'Left the destination GROWI in maintenance mode after the transfer import',
          );
        } else {
          await runPostProcess('restore-maintenance-mode', async () => {
            // Restoring, not clearing: only a destination this procedure closed is opened
            // again, and only back to the state it was found in.
            if (!maintenanceModeBeforeTransfer) {
              await appService.endMaintenanceMode();
              maintenanceModeReleased = true;
              logger.info(
                'Restored the destination GROWI out of maintenance mode after the transfer import',
              );
            }
          });
        }
      }
    }

    // Handed back so the route can put it in the response: the source is a different
    // process, and its own progress events cannot know what happened over here.
    return {
      // Empty when the import threw, which is exactly why `importAborted` is a field of
      // its own — see {@link ImportCollectionsResult}.
      failedCollections: importResult?.failedCollections ?? [],
      importAborted: importResult == null,
      // Reports what actually landed, not what this GROWI attempted: a plan that
      // failed to write back (`!rescueApplied`) is not an outcome, and naming its
      // accounts here would tell the source operator that accounts exist on this
      // destination which do not (see the doc comment on `ImportCollectionsResult`).
      rescue:
        rescuePlan == null
          ? null
          : rescueApplied
            ? toRescueOutcome(rescuePlan)
            : { rescued: [] },
      rescueApplied,
      postProcessFailures,
      maintenanceModeReleased,
    };
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
