import { EnvToModuleMappings } from '~/interfaces/file-uploader';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';
import type { FileUploader } from './file-uploader';

export type { FileUploader } from './file-uploader';

const logger = loggerFactory('growi:service:FileUploaderServise');

// Static loader map keyed by resolved module name. Each entry uses an explicit,
// statically analyzable specifier with the correct path: `aws`/`gcs` are
// directories (`/index.js`); the rest are sibling files (`.js`). A computed
// `import(\`./${method}\`)` cannot express the file-vs-directory distinction —
// it broke NodeNext's runtime resolver in production (task 3.8.b): a bare
// `./aws` only worked under tsx's lenient dev resolution, and `./aws.js`
// (file) does not match the `aws/` directory.
const uploaderModuleLoaders = {
  aws: () => import('./aws'),
  gcs: () => import('./gcs'),
  azure: () => import('./azure'),
  gridfs: () => import('./gridfs'),
  local: () => import('./local'),
  none: () => import('./none'),
};

// Do NOT memoize the uploader instance here: Crowi.setUpFileUpload(isForceUpdate=true)
// relies on every call re-reading app:fileUploadType and producing a fresh uploader
// (admin settings change, S2S switch propagation, G2G transfer). The ESM loader
// already caches the imported module, so only the lightweight factory re-runs.
export const getUploader = async (crowi: Crowi): Promise<FileUploader> => {
  const method =
    EnvToModuleMappings[configManager.getConfig('app:fileUploadType')];
  const loadUploaderModule =
    uploaderModuleLoaders[method as keyof typeof uploaderModuleLoaders];
  if (loadUploaderModule == null) {
    throw new Error(`Unknown file upload method: '${method}'`);
  }
  const { setup } = await loadUploaderModule();
  // The per-uploader `setup` returns its concrete subtype; the union is not
  // structurally assignable to the `FileUploader` supertype, so narrow it back
  // here (the previous computed `import()` returned `any` and skipped this).
  const uploader = setup(crowi) as FileUploader;

  if (uploader == null) {
    logger.warn('Failed to initialize uploader.');
  }

  return uploader;
};

export * from './utils';
