import fs from 'node:fs';
import type { EventEmitter } from 'node:stream';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import gc from 'expose-gc/function.js';
import type {
  BulkOperationBase,
  BulkWriteResult,
  MongoBulkWriteError,
  UnorderedBulkOperation,
  WriteError,
} from 'mongodb';
import type { Document } from 'mongoose';
import mongoose from 'mongoose';
import path from 'pathe';
import unzipStream from 'unzip-stream';

import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import { setupIndependentModels } from '~/server/crowi/setup-models';
import type CollectionProgress from '~/server/models/vo/collection-progress';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

import CollectionProgressingStatus from '../../models/vo/collection-progressing-status';
import { createBatchStream } from '../../util/batch-stream';
import { configManager } from '../config-manager';
import type { ConvertMap } from './construct-convert-map';
import { constructConvertMap } from './construct-convert-map';
import { getModelFromCollectionName } from './get-model-from-collection-name';
import type { ImportSettings, OverwriteParams } from './import-settings';
import { keepOriginal } from './overwrite-function';

import * as JSONStream from 'JSONStream';

const logger = loggerFactory('growi:services:ImportService');

const BULK_IMPORT_SIZE = 100;

/** The collection whose import takes the maintenance-mode flag with it. */
const CONFIGS_COLLECTION_NAME = 'configs';

class ImportingCollectionError extends Error {
  collectionProgress: CollectionProgress;

  constructor(collectionProgress, error) {
    super(error);
    this.collectionProgress = collectionProgress;
  }
}

/**
 * The right to run an import, held for as long as {@link release} has not been called.
 * See {@link ImportService.acquireImportJob}.
 */
export interface ImportJobLease {
  /** Idempotent, and a no-op once someone else holds the job. */
  release: () => void;
}

/** How one collection's import ended: `error` is null when it succeeded. */
interface SettledImport {
  collectionName: string;
  error: unknown;
}

/** The outcome of one import run. */
export interface ImportResult {
  /**
   * The collections whose import threw. An import carries on past a failed collection —
   * that is deliberate and unchanged — so without this the caller has no way to learn
   * that the destination is only half imported. Empty when every collection succeeded.
   */
  readonly failedCollections: readonly string[];
}

export class ImportService {
  private modelCache: Map<string, { Model: any; schema: any }> = new Map();

  private crowi: Crowi;

  private growiBridgeService: any;

  private adminEvent: EventEmitter;

  private currentProgressingStatus: CollectionProgressingStatus | null;

  private convertMap: ConvertMap | undefined;

  /**
   * Who currently holds the right to run an import, if anyone.
   *
   * Deliberately not `currentProgressingStatus`: that one only exists while `import()` is
   * running, whereas the window that has to be protected is longer at both ends — the
   * receive route unzips into the shared directory before it calls `import()`, and still
   * has its own clean-up to do after it returns. A second import let through at either end
   * would empty `users` under the first one's feet.
   */
  private importJobOwner: object | null = null;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.growiBridgeService = crowi.growiBridgeService;

    this.adminEvent = crowi.events.admin;

    this.currentProgressingStatus = null;
  }

  get baseDir(): string {
    return path.join(this.crowi.tmpDir, 'imports');
  }

  getFile(fileName: string): string {
    return this.growiBridgeService.getFile(fileName, this.baseDir);
  }

  /**
   * parse all zip files in downloads dir
   *
   * @memberOf ExportService
   * @return {object} info for zip files and whether currentProgressingStatus exists
   */
  async getStatus() {
    const zipFiles = fs
      .readdirSync(this.baseDir)
      .filter((file) => path.extname(file) === '.zip');

    // process serially so as not to waste memory
    const zipFileStats: any[] = [];
    const parseZipFilePromises: Promise<any>[] = zipFiles.map((file) => {
      const zipFile = this.getFile(file);
      return this.growiBridgeService.parseZipFile(zipFile);
    });
    for await (const stat of parseZipFilePromises) {
      zipFileStats.push(stat);
    }

    // filter null object (broken zip)
    const filtered = zipFileStats.filter((zipFileStat) => zipFileStat != null);
    // sort with ctime("Change Time" - Time when file status was last changed (inode data modification).)
    filtered.sort((a, b) => {
      return a.fileStat.ctime - b.fileStat.ctime;
    });

    const zipFileStat = filtered.pop();
    let isTheSameVersion = false;

    if (zipFileStat != null) {
      try {
        this.validate(zipFileStat.meta);
        isTheSameVersion = true;
      } catch (err) {
        isTheSameVersion = false;
        logger.error('the versions are not met', err);
      }
    }

    return {
      isTheSameVersion,
      zipFileStat,
      isImporting: this.currentProgressingStatus != null,
      progressList: this.currentProgressingStatus?.progressList ?? null,
    };
  }

  async preImport() {
    await setupIndependentModels();

    // initialize convertMap
    this.convertMap = constructConvertMap();
  }

  /**
   * Claims the right to run an import, or returns null if another one already holds it.
   *
   * Both entry points — the G2G receive route and the admin zip import — take this
   * **before they start writing to the shared import directory**, not when `import()` is
   * reached: the receive route unzips, re-reads the archive and queries the destination
   * for conflicts first, and a second import let through during that stretch would
   * overwrite the JSON files the first one is about to read.
   *
   * The routes are the only place this actually refuses anything. `import()` claims the
   * job as well, but does not check the result: a direct call keeps the job claimed for
   * the length of its run — so a route starting meanwhile is turned away — while two
   * direct calls, bypassing both routes, still run side by side.
   *
   * Process-local, so a multi-process deployment can still run two imports at once. That
   * is the same hole as before this existed; it is not widened.
   */
  acquireImportJob(): ImportJobLease | null {
    if (this.importJobOwner != null) {
      return null;
    }

    const owner = {};
    this.importJobOwner = owner;

    return {
      release: () => {
        if (this.importJobOwner === owner) {
          this.importJobOwner = null;
        }
      },
    };
  }

  /**
   * import collections from json
   * @param collections MongoDB collection name
   * @param importSettingsMap
   */
  async import(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
  ): Promise<ImportResult> {
    // Null when someone else already holds the job — the ordinary case, as both routes
    // claim it before they unzip. Deliberately not treated as a refusal: the run goes
    // ahead either way, and the only thing this claim buys is that an import reached
    // directly, without a route, still keeps the job taken for its own length. Releasing
    // only what was claimed here is what keeps it from cutting the caller's claim short.
    const ownLease = this.acquireImportJob();
    try {
      return await this.doImport(collections, importSettingsMap);
    } finally {
      ownLease?.release();
    }
  }

  private async doImport(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
  ): Promise<ImportResult> {
    await this.preImport();

    // init status object
    this.currentProgressingStatus = new CollectionProgressingStatus(
      collections,
    );

    let failedCollections: string[];
    try {
      failedCollections = await this.importCollections(
        collections,
        importSettingsMap,
      );

      await configManager.loadConfigs();

      const currentIsV5Compatible =
        configManager.getConfig('app:isV5Compatible');
      const isImportPagesCollection = collections.includes('pages');
      const shouldNormalizePages =
        currentIsV5Compatible && isImportPagesCollection;

      if (shouldNormalizePages)
        await this.crowi.pageService.normalizeAllPublicPages();

      // Release caches after import process
      this.modelCache.clear();
      this.convertMap = undefined;
    } finally {
      // `getStatus()` answers `isImporting` from this field, so it has to stay set for as
      // long as the run really lasts — the page normalization above included, which takes
      // minutes on a v5 wiki — and it has to be cleared even when that tail work throws,
      // or the screen would go on reporting an import that has already stopped.
      this.currentProgressingStatus = null;
    }

    // Emitted here, at the very end, and only for a run that lost nothing.
    //
    // Its one consumer is the admin screen, which turns it into a green "Import process
    // has completed." Emitted where it used to be — right after the per-collection loop —
    // it told the operator the import was over while the route still held the import
    // claim, so re-importing came back as a 409 the screen had no way to explain. And
    // emitted after a collection had failed it claimed a wiki was fully imported when part
    // of it was missing; the failure is reported by the caller instead (`executeImport`
    // for the admin route, the response body for the G2G one).
    if (failedCollections.length === 0) {
      this.emitTerminateEvent();
    }

    return { failedCollections };
  }

  /**
   * Import every collection and wait for all of them, whatever becomes of each one.
   *
   * A collection that throws does not stop the others — that is long-standing policy and
   * is what makes the returned list the only record of a partial import.
   *
   * @returns the names of the collections whose import threw, in the requested order
   */
  private async importCollections(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
  ): Promise<string[]> {
    // process serially so as not to waste memory
    const importings = collections.map((collectionName) => {
      const importSettings = importSettingsMap.get(collectionName);
      if (importSettings == null) {
        throw new Error(`ImportSettings for ${collectionName} is not found`);
      }

      const importing =
        collectionName === CONFIGS_COLLECTION_NAME
          ? // Chained onto the configs import rather than run alongside it, so the flag is
            // in the database before the `loadConfigs()` the caller runs once every
            // collection is in — and before anything else can reload from a database with
            // no flag in it.
            // `finally`, because a pipeline that fails after `deleteMany()` leaves the row
            // missing just the same.
            (async () => {
              try {
                await this.importCollection(collectionName, importSettings);
              } finally {
                await this.enterMaintenanceMode();
              }
            })()
          : this.importCollection(collectionName, importSettings);

      // Settled here, where the import starts, rather than in the loop below. Every
      // collection is already running by then, so one that fails while an earlier one is
      // still going would be a rejection with nothing attached to it yet — which Node
      // treats as an unhandled rejection and, by default, exits the process over.
      return importing.then(
        (): SettledImport => ({ collectionName, error: null }),
        (error: unknown): SettledImport => ({ collectionName, error }),
      );
    });

    const failedCollections: string[] = [];
    for (const settled of importings) {
      const { collectionName, error } = await settled;
      if (error == null) {
        continue;
      }

      failedCollections.push(collectionName);
      logger.error({ err: error }, `failed to import to ${collectionName}`);

      // Absent when the failure happened before the per-collection progress record could
      // be looked up; the progress event is best-effort, the report above is not.
      const { collectionProgress } = error as ImportingCollectionError;
      if (collectionProgress != null) {
        this.emitProgressEvent(collectionProgress, {
          message: (error as Error).message,
        });
      }
    }

    return failedCollections;
  }

  /**
   * Puts this GROWI into maintenance mode, unconditionally, once the configs collection
   * has been imported.
   *
   * Importing `configs` replaces every setting this GROWI has — including the flag that
   * keeps ordinary users out — with the archive's. What is left behind is a GROWI running
   * on someone else's settings, and, for a transfer, one whose attachments have not
   * started arriving yet. So the import closes it rather than leaving whoever wrote the
   * archive to decide.
   *
   * **Nothing here reopens it.** The admin screens warn the operator before an import or
   * a transfer starts that they will have to switch maintenance mode off themselves. The
   * one exception is the receiving side of a migration transfer, which raises the flag on
   * purpose beforehand and manages its own clean-up.
   */
  private async enterMaintenanceMode(): Promise<void> {
    // Deliberately not caught. A failure here means the configs collection was replaced
    // but the flag was not raised — a GROWI running on the archive's settings, open, with
    // (for a transfer) no attachments yet: exactly the state requirement 2.9 exists to
    // prevent. Letting it throw out of the `finally` that calls this marks `configs` as a
    // failed collection, which is already wired all the way through to the operator (the
    // return value, the response body, the source's failure notice, and the screen's
    // withheld completion). Swallowing it would report that run as a clean success.
    await configManager.updateConfig('app:isMaintenanceMode', true);
  }

  /**
   * import a collection from json
   *
   * @memberOf ImportService
   */
  protected async importCollection(
    collectionName: string,
    importSettings: ImportSettings,
  ): Promise<void> {
    if (this.currentProgressingStatus == null) {
      throw new Error(
        'Something went wrong: currentProgressingStatus is not initialized',
      );
    }
    // Avoid closure references by passing direct method references
    const collection = mongoose.connection.collection(collectionName);

    const { mode, jsonFileName, overwriteParams } = importSettings;
    const collectionProgress =
      this.currentProgressingStatus.progressMap[collectionName];

    try {
      const jsonFile = this.getFile(jsonFileName);

      // validate options
      this.validateImportSettings(collectionName, importSettings);

      // flush
      if (mode === ImportMode.flushAndInsert) {
        await collection.deleteMany({});
      }

      // stream 1
      const readStream = fs.createReadStream(jsonFile, {
        encoding: this.growiBridgeService.getEncoding(),
      });

      // stream 2
      const jsonStream = JSONStream.parse('*');

      // stream 3
      const convertStream = new Transform({
        objectMode: true,
        transform(this: Transform, doc, encoding, callback) {
          try {
            // Direct reference to convertDocuments
            const converted = (importSettings as any).service.convertDocuments(
              collectionName,
              doc,
              overwriteParams,
            );
            this.push(converted);
            callback();
          } catch (error) {
            callback(error);
          }
        },
      });
      // Reference for importService within Transform
      (importSettings as any).service = this;

      // stream 4
      const batchStream = createBatchStream(BULK_IMPORT_SIZE);
      const writeStream = new Writable({
        objectMode: true,
        write: async (batch, encoding, callback) => {
          try {
            const unorderedBulkOp = collection.initializeUnorderedBulkOp();
            // documents are not persisted until unorderedBulkOp.execute()
            batch.forEach((document) => {
              this.bulkOperate(
                unorderedBulkOp,
                collectionName,
                document,
                importSettings,
              );
            });

            // exec
            const { result, errors } =
              await this.execUnorderedBulkOpSafely(unorderedBulkOp);
            const {
              insertedCount,
              modifiedCount,
              upsertedCount,
              matchedCount,
            } = result;
            const errorCount = errors?.length ?? 0;

            // For upsert operations, count matched documents as modified
            const actualModifiedCount =
              importSettings.mode === ImportMode.upsert
                ? matchedCount || 0 // In upsert mode, matchedCount indicates documents that were found and potentially updated
                : modifiedCount;

            const actualInsertedCount =
              importSettings.mode === ImportMode.upsert
                ? upsertedCount || 0 // In upsert mode, upsertedCount indicates newly created documents
                : insertedCount;

            logger.debug(
              `Importing ${collectionName}. Inserted: ${actualInsertedCount}. Modified: ${actualModifiedCount}. Failed: ${errorCount}.` +
                ` (Raw: inserted=${insertedCount}, modified=${modifiedCount}, upserted=${upsertedCount}, matched=${matchedCount})`,
            );
            const increment =
              actualInsertedCount + actualModifiedCount + errorCount;
            collectionProgress.currentCount += increment;
            collectionProgress.totalCount += increment;
            collectionProgress.insertedCount += actualInsertedCount;
            collectionProgress.modifiedCount += actualModifiedCount;
            this.emitProgressEvent(collectionProgress, errors);
            // First aid to prevent unexplained memory leaks
            try {
              logger.info('global.gc() invoked.');
              gc();
            } catch (err) {
              logger.error('fail garbage collection: ', err);
            }
            callback();
          } catch (err) {
            logger.error('Error in writeStream:', err);
            callback(err);
          }
        },
        final(callback) {
          logger.info(`Importing ${collectionName} has completed.`);
          callback();
        },
      });

      await pipeline(
        readStream,
        jsonStream,
        convertStream,
        batchStream,
        writeStream,
      );

      // Ensure final progress event is emitted even when no data was processed
      if (collectionProgress.currentCount === 0) {
        logger.info(
          `No data processed for collection ${collectionName}. Emitting final progress event.`,
        );
        this.emitProgressEvent(collectionProgress, null);
      }

      // clean up tmp directory
      fs.unlinkSync(jsonFile);
    } catch (err) {
      throw new ImportingCollectionError(collectionProgress, err);
    }
  }

  validateImportSettings(
    collectionName: string,
    importSettings: ImportSettings,
  ): void {
    const { mode } = importSettings;

    switch (collectionName) {
      case 'configs':
        if (mode !== ImportMode.flushAndInsert) {
          throw new Error(
            `The specified mode '${mode}' is not allowed when importing to 'configs' collection.`,
          );
        }
        break;
    }
  }

  /**
   * process bulk operation
   */
  bulkOperate(
    bulk: UnorderedBulkOperation,
    collectionName: string,
    document: Record<string, unknown>,
    importSettings: ImportSettings,
  ): BulkOperationBase | void {
    // insert
    if (importSettings.mode !== ImportMode.upsert) {
      // Optimization such as splitting and adding large documents can be considered
      return bulk.insert(document);
    }
    // upsert
    switch (collectionName) {
      case 'pages':
        return bulk.find({ path: document.path }).upsert().replaceOne(document);
      default:
        return bulk.find({ _id: document._id }).upsert().replaceOne(document);
    }
  }

  /**
   * emit progress event
   * @param {CollectionProgress} collectionProgress
   * @param {object} appendedErrors key: collection name, value: array of error object
   */
  emitProgressEvent(
    collectionProgress: CollectionProgress,
    appendedErrors: any,
  ): void {
    const { collectionName } = collectionProgress;

    // send event (in progress in global)
    this.adminEvent.emit('onProgressForImport', {
      collectionName,
      collectionProgress,
      appendedErrors,
    });
  }

  /**
   * emit terminate event
   */
  emitTerminateEvent(): void {
    this.adminEvent.emit('onTerminateForImport');
  }

  /**
   * extract a zip file
   *
   * @memberOf ImportService
   * @param {string} zipFile absolute path to zip file
   * @return {Array.<string>} array of absolute paths to extracted files
   */
  async unzip(zipFile: string): Promise<string[]> {
    const readStream = fs.createReadStream(zipFile);
    const parseStream = unzipStream.Parse();
    const entryPromises: Promise<string | null>[] = [];

    parseStream.on('entry', (/** @type {Entry} */ entry) => {
      const fileName = entry.path;
      // https://regex101.com/r/mD4eZs/6
      // prevent from unexpecting attack doing unzip file (path traversal attack)
      // FOR EXAMPLE
      // ../../src/server/example.html
      if (fileName.match(/(\.\.\/|\.\.\\)/)) {
        logger.error('File path is not appropriate.', fileName);
        entry.autodrain();
        return;
      }

      if (fileName === this.growiBridgeService.getMetaFileName()) {
        // skip meta.json
        entry.autodrain();
      } else {
        const entryPromise = new Promise<string | null>((resolve) => {
          const jsonFile = path.join(this.baseDir, fileName);
          const writeStream = fs.createWriteStream(jsonFile, {
            encoding: this.growiBridgeService.getEncoding(),
          });

          pipeline(entry, writeStream)
            .then(() => resolve(jsonFile))
            .catch((err) => {
              logger.error('Failed to extract entry:', err);
              resolve(null); // Continue processing other entries
            });
        });

        entryPromises.push(entryPromise);
      }
    });

    await pipeline(readStream, parseStream);
    const results = await Promise.allSettled(entryPromises);

    return results
      .filter(
        (result): result is PromiseFulfilledResult<string> =>
          result.status === 'fulfilled' && result.value !== null,
      )
      .map((result) => result.value);
  }

  /**
   * execute unorderedBulkOp and ignore errors
   *
   * @memberOf ImportService
   */
  async execUnorderedBulkOpSafely(
    unorderedBulkOp: UnorderedBulkOperation,
  ): Promise<{ result: BulkWriteResult; errors?: WriteError[] }> {
    try {
      return {
        result: await unorderedBulkOp.execute(),
      };
    } catch (err) {
      const errTypeGuard = (err): err is MongoBulkWriteError => {
        return 'result' in err && 'writeErrors' in err;
      };

      if (errTypeGuard(err)) {
        return {
          result: err.result,
          errors: Array.isArray(err.writeErrors)
            ? err.writeErrors
            : [err.writeErrors],
        };
      }

      logger.error(
        'Failed to execute unorderedBulkOp and the error could not handled.',
        err,
      );
      throw new Error(
        'Failed to execute unorderedBulkOp and the error could not handled.',
        err,
      );
    }
  }

  /**
   * execute unorderedBulkOp and ignore errors
   *
   * @memberOf ImportService
   * @param collectionName
   * @param document document being imported
   * @returns document to be persisted
   */
  convertDocuments<D extends Document>(
    collectionName: string,
    document: D,
    overwriteParams: OverwriteParams,
  ): D {
    // Model and schema cache (optimization)
    if (!this.modelCache) {
      this.modelCache = new Map();
    }

    let modelInfo = this.modelCache.get(collectionName);
    if (!modelInfo) {
      const Model = getModelFromCollectionName(collectionName);
      const schema = Model != null ? Model.schema : undefined;
      modelInfo = { Model, schema };
      this.modelCache.set(collectionName, modelInfo);
    }

    const { schema } = modelInfo;
    const convertMap = this.convertMap?.[collectionName];

    // Use shallow copy instead of structuredClone() when sufficient
    const _document: D =
      typeof document === 'object' &&
      document !== null &&
      !Array.isArray(document)
        ? { ...document }
        : structuredClone(document);

    Object.entries(document).forEach(([propertyName, value]) => {
      // Check if there's a custom convert function for this property, otherwise use keepOriginal
      const convertedValue = convertMap?.[propertyName];
      const convertFunc =
        convertedValue != null && typeof convertedValue === 'function'
          ? convertedValue
          : keepOriginal;

      _document[propertyName] = convertFunc(value, {
        document,
        propertyName,
        schema,
      });
    });

    // overwrite documents with custom values
    Object.entries(overwriteParams).forEach(
      ([propertyName, overwriteValue]) => {
        const value = document[propertyName];

        // distinguish between null and undefined
        if (value !== undefined) {
          const overwriteFunc =
            typeof overwriteValue === 'function' ? overwriteValue : null;
          _document[propertyName] =
            overwriteFunc != null
              ? overwriteFunc(value, {
                  document: _document,
                  propertyName,
                  schema,
                })
              : overwriteValue;
        }
      },
    );
    return _document;
  }

  /**
   * validate using meta.json
   * to pass validation, all the criteria must be met
   *   - ${version of this GROWI} === ${version of GROWI that exported data}
   *
   * @memberOf ImportService
   * @param {object} meta meta data from meta.json
   */
  validate(meta: any): void {
    if (meta.version !== getGrowiVersion()) {
      throw new Error(
        'The version of this GROWI and the uploaded GROWI data are not the same',
      );
    }

    // TODO: check if all migrations are completed
    // - export: throw err if there are pending migrations
    // - import: throw err if there are pending migrations
  }

  /**
   * Delete all uploaded files
   */
  deleteAllZipFiles(): void {
    fs.readdirSync(this.baseDir)
      .filter((file) => path.extname(file) === '.zip')
      .forEach((file) => {
        fs.unlinkSync(path.join(this.baseDir, file));
      });
  }
}
