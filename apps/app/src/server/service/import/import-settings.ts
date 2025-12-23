import type { ImportMode } from '~/models/admin/import-mode';

import type { OverwriteFunction } from './overwrite-function';

export type OverwriteParams = {
  [propertyName: string]: OverwriteFunction | unknown;
};

export type ImportSettings = {
  mode: ImportMode;
  jsonFileName: string;
  overwriteParams: OverwriteParams;
};
