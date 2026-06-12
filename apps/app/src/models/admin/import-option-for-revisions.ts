import { ImportMode } from '~/models/admin/import-mode.js';

import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option.js';

const DEFAULT_PROPS = {
  isOverwriteAuthorWithCurrentUser: false,
};

export class ImportOptionForRevisions extends GrowiArchiveImportOption {
  constructor(
    collectionName: string,
    mode: ImportMode = ImportMode.insert,
    initProps = DEFAULT_PROPS,
  ) {
    super(collectionName, mode, initProps);
  }
}
