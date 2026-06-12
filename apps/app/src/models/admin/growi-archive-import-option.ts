import { ImportMode } from './import-mode.js';

export class GrowiArchiveImportOption {
  collectionName: string;

  mode: ImportMode;

  constructor(
    collectionName: string,
    mode: ImportMode = ImportMode.insert,
    initProps = {},
  ) {
    this.collectionName = collectionName;
    this.mode = mode;

    Object.entries(initProps).forEach(([key, value]) => {
      this[key] = value;
    });
  }
}
