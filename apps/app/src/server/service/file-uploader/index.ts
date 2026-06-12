import { EnvToModuleMappings } from '~/interfaces/file-uploader';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager/index.js';
import type { FileUploader } from './file-uploader.js';

export type { FileUploader } from './file-uploader.js';

const logger = loggerFactory('growi:service:FileUploaderServise');

// Do NOT memoize the uploader instance here: Crowi.setUpFileUpload(isForceUpdate=true)
// relies on every call re-reading app:fileUploadType and producing a fresh uploader
// (admin settings change, S2S switch propagation, G2G transfer). The ESM loader
// already caches the imported module, so only the lightweight factory re-runs.
export const getUploader = async (crowi: Crowi): Promise<FileUploader> => {
  const method =
    EnvToModuleMappings[configManager.getConfig('app:fileUploadType')];
  const modulePath = `./${method}`;
  const mod = await import(modulePath);
  const factory = mod.default ?? mod.setup ?? mod;
  const uploader = factory(crowi);

  if (uploader == null) {
    logger.warn('Failed to initialize uploader.');
  }

  return uploader;
};

export * from './utils/index.js';
