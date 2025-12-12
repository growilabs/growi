import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { finished } from 'stream/promises';
import unzipStream, { type Entry } from 'unzip-stream';

import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import type { ZipFileStat } from '../interfaces/export';
import { tapStreamDataByPromise } from './unzip-stream-utils';

const logger = loggerFactory('growi:services:GrowiBridgeService'); // eslint-disable-line no-unused-vars

/**
 * the service class for bridging GROWIs (export and import)
 * common properties and methods between export service and import service are defined in this service
 */
export class GrowiBridgeService {
  crowi: Crowi;

  encoding: BufferEncoding = 'utf-8';

  metaFileName = 'meta.json';

  baseDir: string | undefined;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  /**
   * getter for encoding
   *
   * @memberOf GrowiBridgeService
   * @return {BufferEncoding} encoding
   */
  getEncoding(): BufferEncoding {
    return this.encoding;
  }

  /**
   * getter for metaFileName
   *
   * @memberOf GrowiBridgeService
   * @return {string} base name of meta file
   */
  getMetaFileName(): string {
    return this.metaFileName;
  }

  /**
   * get the absolute path to a file
   *
   * @memberOf GrowiBridgeService
   */
  getFile(fileName: string, baseDir: string): string {
    const jsonFile = path.join(baseDir, fileName);

    // throws err if the file does not exist
    fs.accessSync(jsonFile);

    return jsonFile;
  }

  /**
   * parse a zip file
   *
   * @memberOf GrowiBridgeService
   * @param {string} zipFile path to zip file
   * @return {object} meta{object} and files{Array.<object>}
   */
  async parseZipFile(zipFile: string): Promise<ZipFileStat | null> {
    const fileStat = fs.statSync(zipFile);
    const innerFileStats: Array<{
      fileName: string;
      collectionName: string;
      size: number;
    }> = [];
    let meta = {};

    const readStream = fs.createReadStream(zipFile);
    const parseStream = unzipStream.Parse();
    const unzipEntryStream = pipeline(readStream, parseStream, () => {});

    let tapPromise: Promise<void> | undefined;

    unzipEntryStream.on('entry', (entry: Entry) => {
      const fileName = entry.path;
      const size = entry.size; // might be undefined in some archives
      if (fileName === this.getMetaFileName()) {
        tapPromise = tapStreamDataByPromise(entry).then((metaBuffer) => {
          meta = JSON.parse(metaBuffer.toString());
        });
      } else {
        innerFileStats.push({
          fileName,
          collectionName: path.basename(fileName, '.json'),
          size,
        });
      }
      entry.autodrain();
    });

    try {
      await finished(unzipEntryStream);
      if (tapPromise != null) {
        await tapPromise;
      }
    } catch (err) {
      // if zip is broken
      logger.error(err);
      return null;
    }

    return {
      meta,
      fileName: path.basename(zipFile),
      zipFilePath: zipFile,
      fileStat,
      innerFileStats,
    };
  }
}
