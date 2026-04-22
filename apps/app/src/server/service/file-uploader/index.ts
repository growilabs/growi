import { EnvToModuleMappings } from '~/interfaces/file-uploader';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';
import type { FileUploader } from './file-uploader';

export type { FileUploader } from './file-uploader';

const logger = loggerFactory('growi:service:FileUploaderServise');

// Memoized uploader instance — lazily initialized on first call
let cachedUploader: FileUploader | null = null;

export const getUploader = async (crowi: Crowi): Promise<FileUploader> => {
  if (cachedUploader != null) {
    return cachedUploader;
  }

  const method =
    EnvToModuleMappings[configManager.getConfig('app:fileUploadType')];
  const modulePath = `./${method}`;
  const mod = await import(modulePath);
  const factory = mod.default ?? mod.setup ?? mod;
  const uploader = factory(crowi);

  if (uploader == null) {
    logger.warn('Failed to initialize uploader.');
  }

  cachedUploader = uploader;
  return uploader;
};

export * from './utils';
