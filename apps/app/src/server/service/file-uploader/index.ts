import { EnvToModuleMappings } from '~/interfaces/file-uploader';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';

import type { FileUploader } from './file-uploader';

export type { FileUploader } from './file-uploader';

const logger = loggerFactory('growi:service:FileUploaderServise');

// Extended FileUploader type with cleanup function
export interface FileUploaderWithCleanup extends FileUploader {
  cleanup?: () => Promise<void>;
}

export const getUploader = (crowi: Crowi): FileUploaderWithCleanup => {
  const method = EnvToModuleMappings[configManager.getConfig('app:fileUploadType')];
  const modulePath = `./${method}`;
  const uploader = require(modulePath)(crowi);

  if (uploader == null) {
    logger.warn('Failed to initialize uploader.');
  }

  return uploader;
};

export * from './utils';
