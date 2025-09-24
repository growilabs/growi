import mongoose from 'mongoose';

import type { OverwriteFunction } from './overwrite-function';
import { keepOriginal } from './overwrite-function';


export type ConvertMap = {
  [collectionName: string]: {
    [propertyName: string]: OverwriteFunction,
  }
}

/**
 * Initialize convert map. set keepOriginal as default
 *
 * @param {Crowi} crowi Crowi instance
 */
export const constructConvertMap = (): ConvertMap => {
  const convertMap: ConvertMap = {};

  mongoose.modelNames().forEach((modelName) => {
    const model = mongoose.model(modelName);

    if (model.collection == null) {
      return;
    }

    const collectionName = model.collection.name;

    convertMap[collectionName] = {};

    for (const key of Object.keys(model.schema.paths)) {
      convertMap[collectionName][key] = keepOriginal;
    }
  });

  return convertMap;
};
