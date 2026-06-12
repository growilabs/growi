import type Crowi from '~/server/crowi/index.js';

import { ImportService } from './import.js';

let instance: ImportService;

export const initializeImportService = (crowi: Crowi): void => {
  if (instance == null) {
    instance = new ImportService(crowi);
  }
};

export const getImportService = (): ImportService => {
  if (instance == null) {
    throw new Error('ImportService has not been initialized');
  }
  return instance;
};

export * from './import-settings.js';
