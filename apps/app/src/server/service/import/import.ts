import fs from 'fs';
import path from 'path';
import type { EventEmitter } from 'stream';
import { Writable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import JSONStream from 'JSONStream';
import gc from 'expose-gc/function';
import type {
  BulkWriteResult, MongoBulkWriteError, UnorderedBulkOperation, WriteError, BulkOperationBase,
} from 'mongodb';
import type { Document } from 'mongoose';
import mongoose from 'mongoose';
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


const logger = loggerFactory('growi:services:ImportService'); // eslint-disable-line no-unused-vars


const BULK_IMPORT_SIZE = 100;


class ImportingCollectionError extends Error {

  collectionProgress: CollectionProgress;

  constructor(collectionProgress, error) {
    super(error);
    this.collectionProgress = collectionProgress;
  }

}


export class ImportService {

  private modelCache: Map<string, { Model: any, schema: any }> = new Map();

  private crowi: Crowi;

  private growiBridgeService: any;

  private adminEvent: EventEmitter;

  private currentProgressingStatus: CollectionProgressingStatus | null;

  private convertMap: ConvertMap | undefined;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.growiBridgeService = crowi.growiBridgeService;

    this.adminEvent = crowi.event('admin');

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
    const zipFiles = fs.readdirSync(this.baseDir).filter(file => path.extname(file) === '.zip');

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
    const filtered = zipFileStats
      .filter(zipFileStat => zipFileStat != null);
    // sort with ctime("Change Time" - Time when file status was last changed (inode data modification).)
    filtered.sort((a, b) => { return a.fileStat.ctime - b.fileStat.ctime });

    const zipFileStat = filtered.pop();
    let isTheSameVersion = false;

    if (zipFileStat != null) {
      try {
        this.validate(zipFileStat.meta);
        isTheSameVersion = true;
      }
      catch (err) {
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
   * import collections from json
   * @param collections MongoDB collection name
   * @param importSettingsMap
   */
  async import(collections: string[], importSettingsMap: { [collectionName: string]: ImportSettings }): Promise<void> {
    await this.preImport();

    // init status object
    this.currentProgressingStatus = new CollectionProgressingStatus(collections);

    // process serially so as not to waste memory
    const promises = collections.map((collectionName) => {
      const importSettings = importSettingsMap[collectionName];
      return this.importCollection(collectionName, importSettings);
    });
    for await (const promise of promises) {
      try {
        await promise;
      }
      // catch ImportingCollectionError
      catch (err) {
        const { collectionProgress } = err;
        logger.error(`failed to import to ${collectionProgress.collectionName}`, err);
        this.emitProgressEvent(collectionProgress, { message: err.message });
      }
    }

    this.currentProgressingStatus = null;
    this.emitTerminateEvent();

    await configManager.loadConfigs();

    const currentIsV5Compatible = configManager.getConfig('app:isV5Compatible');
    const isImportPagesCollection = collections.includes('pages');
    const shouldNormalizePages = currentIsV5Compatible && isImportPagesCollection;

    if (shouldNormalizePages) await this.crowi.pageService.normalizeAllPublicPages();

    // Release caches after import process
    this.modelCache.clear();
    this.convertMap = undefined;
  }

  /**
   * import a collection from json
   *
   * @memberOf ImportService
   */
  protected async importCollection(collectionName: string, importSettings: ImportSettings): Promise<void> {
    if (this.currentProgressingStatus == null) {
      throw new Error('Something went wrong: currentProgressingStatus is not initialized');
    }
    // Avoid closure references by passing direct method references
    const collection = mongoose.connection.collection(collectionName);

    const { mode, jsonFileName, overwriteParams } = importSettings;
    const collectionProgress = this.currentProgressingStatus.progressMap[collectionName];

    try {
      const jsonFile = this.getFile(jsonFileName);

      // validate options
      this.validateImportSettings(collectionName, importSettings);

      // flush
      if (mode === ImportMode.flushAndInsert) {
        await collection.deleteMany({});
      }

      // stream 1
      const readStream = fs.createReadStream(jsonFile, { encoding: this.growiBridgeService.getEncoding() });

      // stream 2
      const jsonStream = JSONStream.parse('*');

      // stream 3
      const convertStream = new Transform({
        objectMode: true,
        transform(this: Transform, doc, encoding, callback) {
          try {
          // Direct reference to convertDocuments
            const converted = (importSettings as any).service.convertDocuments(collectionName, doc, overwriteParams);
            this.push(converted);
            callback();
          }
          catch (error) {
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
        write: async(batch, encoding, callback) => {
          try {
            const unorderedBulkOp = collection.initializeUnorderedBulkOp();
            // documents are not persisted until unorderedBulkOp.execute()
            batch.forEach((document) => {
              this.bulkOperate(unorderedBulkOp, collectionName, document, importSettings);
            });

            // exec
            const { result, errors } = await this.execUnorderedBulkOpSafely(unorderedBulkOp);
            const {
              insertedCount, modifiedCount, upsertedCount, matchedCount,
            } = result;
            const errorCount = errors?.length ?? 0;

            // For upsert operations, count matched documents as modified
            const actualModifiedCount = importSettings.mode === ImportMode.upsert
              ? (matchedCount || 0) // In upsert mode, matchedCount indicates documents that were found and potentially updated
              : modifiedCount;

            const actualInsertedCount = importSettings.mode === ImportMode.upsert
              ? (upsertedCount || 0) // In upsert mode, upsertedCount indicates newly created documents
              : insertedCount;

            logger.debug(`Importing ${collectionName}. Inserted: ${actualInsertedCount}. Modified: ${actualModifiedCount}. Failed: ${errorCount}.`
              + ` (Raw: inserted=${insertedCount}, modified=${modifiedCount}, upserted=${upsertedCount}, matched=${matchedCount})`);
            const increment = actualInsertedCount + actualModifiedCount + errorCount;
            collectionProgress.currentCount += increment;
            collectionProgress.totalCount += increment;
            collectionProgress.insertedCount += actualInsertedCount;
            collectionProgress.modifiedCount += actualModifiedCount;
            this.emitProgressEvent(collectionProgress, errors);
            // First aid to prevent unexplained memory leaks
            try {
              logger.info('global.gc() invoked.');
              gc();
            }
            catch (err) {
              logger.error('fail garbage collection: ', err);
            }
            callback();
          }
          catch (err) {
            logger.error('Error in writeStream:', err);
            callback(err);
          }
        },
        final(callback) {
          logger.info(`Importing ${collectionName} has completed.`);
          callback();
        },
      });

      await pipeline(readStream, jsonStream, convertStream, batchStream, writeStream);

      // Ensure final progress event is emitted even when no data was processed
      if (collectionProgress.currentCount === 0) {
        logger.info(`No data processed for collection ${collectionName}. Emitting final progress event.`);
        this.emitProgressEvent(collectionProgress, null);
      }

      // clean up tmp directory
      fs.unlinkSync(jsonFile);
    }
    catch (err) {
      throw new ImportingCollectionError(collectionProgress, err);
    }
  }

  validateImportSettings(collectionName: string, importSettings: ImportSettings): void {
    const { mode } = importSettings;

    switch (collectionName) {
      case 'configs':
        if (mode !== ImportMode.flushAndInsert) {
          throw new Error(`The specified mode '${mode}' is not allowed when importing to 'configs' collection.`);
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
  emitProgressEvent(collectionProgress: CollectionProgress, appendedErrors: any): void {
    const { collectionName } = collectionProgress;

    // send event (in progress in global)
    this.adminEvent.emit('onProgressForImport', { collectionName, collectionProgress, appendedErrors });
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
      }
      else {
        const entryPromise = new Promise<string | null>((resolve) => {
          const jsonFile = path.join(this.baseDir, fileName);
          const writeStream = fs.createWriteStream(jsonFile, { encoding: this.growiBridgeService.getEncoding() });

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
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value);
  }

  /**
   * execute unorderedBulkOp and ignore errors
   *
   * @memberOf ImportService
   */
  async execUnorderedBulkOpSafely(unorderedBulkOp: UnorderedBulkOperation): Promise<{ result: BulkWriteResult, errors?: WriteError[] }> {
    try {
      return {
        result: await unorderedBulkOp.execute(),
      };
    }
    catch (err) {
      const errTypeGuard = (err): err is MongoBulkWriteError => {
        return 'result' in err && 'writeErrors' in err;
      };

      if (errTypeGuard(err)) {
        return {
          result: err.result,
          errors: Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors],
        };
      }

      logger.error('Failed to execute unorderedBulkOp and the error could not handled.', err);
      throw new Error('Failed to execute unorderedBulkOp and the error could not handled.', err);
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
  convertDocuments<D extends Document>(collectionName: string, document: D, overwriteParams: OverwriteParams): D {
  // Model and schema cache (optimization)
    if (!this.modelCache) {
      this.modelCache = new Map();
    }

    let modelInfo = this.modelCache.get(collectionName);
    if (!modelInfo) {
      const Model = getModelFromCollectionName(collectionName);
      const schema = (Model != null) ? Model.schema : undefined;
      modelInfo = { Model, schema };
      this.modelCache.set(collectionName, modelInfo);
    }

    const { schema } = modelInfo;
    const convertMap = this.convertMap?.[collectionName];

    // Use shallow copy instead of structuredClone() when sufficient
    const _document: D = (typeof document === 'object' && document !== null && !Array.isArray(document)) ? { ...document } : structuredClone(document);
    Object.entries(document).forEach(([propertyName, value]) => {
      _document[propertyName] = keepOriginal(value, { document, propertyName });
    });
    if (convertMap != null) {
      // assign value from documents being imported
      Object.entries(convertMap).forEach(([propertyName, convertedValue]) => {
        const value = document[propertyName];

        // distinguish between null and undefined
        if (value === undefined) {
          return; // next entry
        }

        const convertFunc = (typeof convertedValue === 'function') ? convertedValue : null;
        _document[propertyName] = (convertFunc != null) ? convertFunc(value, { document, propertyName, schema }) : convertedValue;
      });
    }

    // overwrite documents with custom values
    Object.entries(overwriteParams).forEach(([propertyName, overwriteValue]) => {
      const value = document[propertyName];

      // distinguish between null and undefined
      if (value !== undefined) {
        const overwriteFunc = (typeof overwriteValue === 'function') ? overwriteValue : null;
        _document[propertyName] = (overwriteFunc != null) ? overwriteFunc(value, { document: _document, propertyName, schema }) : overwriteValue;
      }
    });
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
      throw new Error('The version of this GROWI and the uploaded GROWI data are not the same');
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
      .filter(file => path.extname(file) === '.zip')
      .forEach(file => fs.unlinkSync(path.join(this.baseDir, file)));
  }

}
