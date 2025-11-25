import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';

import { toArrayIfNot } from '~/utils/array-utils';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

import type CollectionProgress from '../models/vo/collection-progress';
import CollectionProgressingStatus from '../models/vo/collection-progressing-status';
import type AppService from './app';
import { configManager } from './config-manager';
import type { GrowiBridgeService } from './growi-bridge';
import { growiInfoService } from './growi-info';
import type { ZipFileStat } from './interfaces/export';

const logger = loggerFactory('growi:services:ExportService');
const { pipeline, finished } = require('stream/promises');

const mongoose = require('mongoose');

class ExportProgressingStatus extends CollectionProgressingStatus {
  async init() {
    // retrieve total document count from each collections
    const promises = this.progressList.map(async (collectionProgress) => {
      const collection = mongoose.connection.collection(
        collectionProgress.collectionName,
      );
      collectionProgress.totalCount = await collection.count();
    });
    await Promise.all(promises);

    this.recalculateTotalCount();
  }
}

class ExportService {
  crowi: any;

  appService: AppService;

  growiBridgeService: GrowiBridgeService;

  per = 100;

  zlibLevel = 9; // 0(min) - 9(max)

  currentProgressingStatus: ExportProgressingStatus | null;

  baseDir: string;

  adminEvent: any;

  constructor(crowi) {
    this.crowi = crowi;
    this.appService = crowi.appService;
    this.growiBridgeService = crowi.growiBridgeService;
    this.baseDir = path.join(crowi.tmpDir, 'downloads');

    this.adminEvent = crowi.event('admin');

    this.currentProgressingStatus = null;
  }

  /**
   *
   * @param {string} fileName
   * @returns {string} path to the file
   */
  getFile(fileName) {
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
    const zipFileStats: Array<ZipFileStat | null> = [];
    const parseZipFilePromises = zipFiles.map((file) => {
      const zipFile = this.getFile(file);
      return this.growiBridgeService.parseZipFile(zipFile);
    });
    for await (const stat of parseZipFilePromises) {
      zipFileStats.push(stat);
    }

    // filter null object (broken zip)
    const filtered = zipFileStats.filter((element) => element != null);

    const isExporting = this.currentProgressingStatus != null;

    return {
      zipFileStats: filtered,
      isExporting,
      progressList: isExporting
        ? this.currentProgressingStatus?.progressList
        : null,
    };
  }

  /**
   * create meta.json
   *
   * @memberOf ExportService
   * @return {string} path to meta.json
   */
  async createMetaJson(): Promise<string> {
    const metaJson = path.join(
      this.baseDir,
      this.growiBridgeService.getMetaFileName(),
    );
    const writeStream = fs.createWriteStream(metaJson, {
      encoding: this.growiBridgeService.getEncoding(),
    });
    const passwordSeed = this.crowi.env.PASSWORD_SEED || null;

    const metaData = {
      version: getGrowiVersion(),
      url: growiInfoService.getSiteUrl(),
      passwordSeed,
      exportedAt: new Date(),
      envVars: configManager.getManagedEnvVars(),
    };

    writeStream.write(JSON.stringify(metaData));
    writeStream.close();

    await finished(writeStream);

    return metaJson;
  }

  /**
   *
   * @param {ExportProgress} exportProgress
   * @return {Transform}
   */
  generateLogStream(exportProgress: CollectionProgress | undefined): Transform {
    const logProgress = this.logProgress.bind(this);

    let count = 0;

    return new Transform({
      transform(chunk, encoding, callback) {
        count++;
        logProgress(exportProgress, count);

        this.push(chunk);

        callback();
      },
    });
  }

  /**
   * insert beginning/ending brackets and comma separator for Json Array
   *
   * @memberOf ExportService
   * @return {Transform}
   */
  generateTransformStream(): Transform {
    let isFirst = true;

    const transformStream = new Transform({
      transform(chunk, encoding, callback) {
        // write beginning brace
        if (isFirst) {
          this.push('[');
          isFirst = false;
        }
        // write separator
        else {
          this.push(',');
        }

        this.push(chunk);
        callback();
      },
      final(callback) {
        // write beginning brace
        if (isFirst) {
          this.push('[');
        }
        // write ending brace
        this.push(']');
        callback();
      },
    });

    return transformStream;
  }

  /**
   * dump a mongodb collection into json
   *
   * @memberOf ExportService
   * @param {string} collectionName collection name
   * @return {string} path to zip file
   */
  async exportCollectionToJson(collectionName: string): Promise<string> {
    const collection = mongoose.connection.collection(collectionName);

    const nativeCursor = collection.find();
    const readStream = nativeCursor.stream({ transform: JSON.stringify });

    // get TransformStream
    const transformStream = this.generateTransformStream();

    // log configuration
    const exportProgress =
      this.currentProgressingStatus?.progressMap[collectionName];
    const logStream = this.generateLogStream(exportProgress);

    // create WritableStream
    const jsonFileToWrite = path.join(this.baseDir, `${collectionName}.json`);
    const writeStream = fs.createWriteStream(jsonFileToWrite, {
      encoding: this.growiBridgeService.getEncoding(),
    });

    await pipeline(readStream, logStream, transformStream, writeStream);

    return writeStream.path.toString();
  }

  /**
   * export multiple Collections into json and Zip
   *
   * @memberOf ExportService
   * @param {Array.<string>} collections array of collection name
   * @return {Array.<ZipFileStat>} info of zip file created
   */
  async exportCollectionsToZippedJson(
    collections: string[],
  ): Promise<ZipFileStat | null> {
    const metaJson = await this.createMetaJson();

    // process serially so as not to waste memory
    const jsonFiles: string[] = [];
    const jsonFilesPromises = collections.map((collectionName) =>
      this.exportCollectionToJson(collectionName),
    );
    for await (const jsonFile of jsonFilesPromises) {
      jsonFiles.push(jsonFile);
    }

    // send terminate event
    this.emitStartZippingEvent();

    // zip json
    const configs = jsonFiles.map((jsonFile) => {
      return { from: jsonFile, as: path.basename(jsonFile) };
    });
    // add meta.json in zip
    configs.push({ from: metaJson, as: path.basename(metaJson) });
    // exec zip
    const zipFile = await this.zipFiles(configs);

    // get stats for the zip file
    const addedZipFileStat =
      await this.growiBridgeService.parseZipFile(zipFile);

    // send terminate event
    this.emitTerminateEvent(addedZipFileStat);

    return addedZipFileStat;

    // TODO: remove broken zip file
  }

  async export(collections: string[]): Promise<ZipFileStat | null> {
    if (this.currentProgressingStatus != null) {
      throw new Error('There is an exporting process running.');
    }

    this.currentProgressingStatus = new ExportProgressingStatus(collections);
    await this.currentProgressingStatus.init();

    let zipFileStat: ZipFileStat | null;
    try {
      zipFileStat = await this.exportCollectionsToZippedJson(collections);
    } finally {
      this.currentProgressingStatus = null;
    }

    return zipFileStat;
  }

  /**
   * log export progress
   *
   * @memberOf ExportService
   *
   * @param {CollectionProgress} collectionProgress
   * @param {number} currentCount number of items exported
   */
  logProgress(
    collectionProgress: CollectionProgress | undefined,
    currentCount: number,
  ): void {
    if (collectionProgress == null) return;

    const output = `${collectionProgress.collectionName}: ${currentCount}/${collectionProgress.totalCount} written`;

    // update exportProgress.currentCount
    collectionProgress.currentCount = currentCount;

    // output every this.per items
    if (currentCount % this.per === 0) {
      logger.debug(output);
      this.emitProgressEvent();
    }
    // output last item
    else if (currentCount === collectionProgress.totalCount) {
      logger.info(output);
      this.emitProgressEvent();
    }
  }

  /**
   * emit progress event
   */
  emitProgressEvent(): void {
    const data = {
      currentCount: this.currentProgressingStatus?.currentCount,
      totalCount: this.currentProgressingStatus?.totalCount,
      progressList: this.currentProgressingStatus?.progressList,
    };

    // send event (in progress in global)
    this.adminEvent.emit('onProgressForExport', data);
  }

  /**
   * emit start zipping event
   */
  emitStartZippingEvent(): void {
    this.adminEvent.emit('onStartZippingForExport', {});
  }

  /**
   * emit terminate event
   * @param {object} zipFileStat added zip file status data
   */
  emitTerminateEvent(zipFileStat: ZipFileStat | null): void {
    this.adminEvent.emit('onTerminateForExport', {
      addedZipFileStat: zipFileStat,
    });
  }

  /**
   * zip files into one zip file
   *
   * @memberOf ExportService
   * @param {object|array<object>} configs object or array of object { from: "path to source file", as: "file name after unzipped" }
   * @return {string} absolute path to the zip file
   * @see https://www.archiverjs.com/#quick-start
   */
  async zipFiles(_configs: { from: string; as: string }[]): Promise<string> {
    const configs = toArrayIfNot(_configs);
    const appTitle = this.appService.getAppTitle();
    const timeStamp = new Date().getTime();
    const zipFile = path.join(
      this.baseDir,
      `${appTitle}-${timeStamp}.growi.zip`,
    );
    const archive = archiver('zip', {
      zlib: { level: this.zlibLevel },
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') logger.error(err);
      else throw err;
    });

    // good practice to catch this error explicitly
    archive.on('error', (err) => {
      throw err;
    });

    for (const { from, as } of configs) {
      const input = fs.createReadStream(from);

      // append a file from stream
      archive.append(input, { name: as });
    }

    const output = fs.createWriteStream(zipFile);

    // finalize the archive (ie we are done appending files but streams have to finish yet)
    // 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
    archive.finalize();

    // pipe archive data to the file
    await pipeline(archive, output);

    logger.info(
      `zipped GROWI data into ${zipFile} (${archive.pointer()} bytes)`,
    );

    // delete json files
    for (const { from } of configs) {
      fs.unlinkSync(from);
    }

    return zipFile;
  }

  getReadStreamFromRevision(revision, format): Readable {
    const data = revision.body;

    const readable = new Readable();
    readable._read = () => {};
    readable.push(data);
    readable.push(null);

    return readable;
  }
}

// eslint-disable-next-line import/no-mutable-exports
export let exportService: ExportService | undefined; // singleton instance
export default function instanciate(crowi: any): void {
  exportService = new ExportService(crowi);
}
