import mongoose from 'mongoose';

import type { OverwriteFunction } from './overwrite-function';
import { keepOriginal } from './overwrite-function';


export type ConvertMap = {
  [collectionName: string]: {
    [propertyName: string]: OverwriteFunction,
  }
}

/**
 * Special conversion functions for problematic fields
 * Add entries here for fields that require custom handling during import
 */
const SPECIAL_CONVERT_FUNCTIONS: Record<string, Record<string, OverwriteFunction>> = {
  activities: {
    snapshot: (value: unknown) => value, // Skip SubdocumentPath casting to avoid Mongoose errors
  },
  // Add more collections and fields as needed:
  // otherCollection: {
  //   problematicField: (value: unknown) => customProcessing(value),
  // },
};

/**
 * Get special conversion function for a specific collection.field combination
 */
const getSpecialConvertFunction = (collectionName: string, propertyName: string): OverwriteFunction | null => {
  return SPECIAL_CONVERT_FUNCTIONS[collectionName]?.[propertyName] ?? null;
};

/**
 * Initialize convert map. set keepOriginal as default
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
      const specialHandler = getSpecialConvertFunction(collectionName, key);
      convertMap[collectionName][key] = specialHandler ?? keepOriginal;
    }
  });

  return convertMap;
};
