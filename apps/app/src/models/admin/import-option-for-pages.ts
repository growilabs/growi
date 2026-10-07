import { ImportMode } from '~/models/admin/import-mode';

import { GrowiArchiveImportOption } from './growi-archive-import-option';

const DEFAULT_PROPS = {
  isOverwriteAuthorWithCurrentUser: false,
  makePublicForGrant2: false,
  makePublicForGrant4: false,
  makePublicForGrant5: false,
  initPageMetadatas: false,
};

export class ImportOptionForPages extends GrowiArchiveImportOption {
  // `declare` keeps these as type-only members (no runtime field emit). Under
  // `useDefineForClassFields` (target ESNext), a bare field declaration would
  // emit `this.x = undefined` AFTER super(), clobbering the values the base
  // constructor assigns from initProps — which then get dropped by
  // JSON.stringify (undefined keys are omitted) and fail the server-side
  // `isImportOptionForPages` guard. See generateOverwriteParams.
  declare isOverwriteAuthorWithCurrentUser: boolean;

  declare makePublicForGrant2: boolean;

  declare makePublicForGrant4: boolean;

  declare makePublicForGrant5: boolean;

  declare initPageMetadatas: boolean;

  constructor(
    collectionName: string,
    mode: ImportMode = ImportMode.insert,
    initProps = DEFAULT_PROPS,
  ) {
    super(collectionName, mode, initProps);
  }
}

export const isImportOptionForPages = (
  opt: GrowiArchiveImportOption,
): opt is ImportOptionForPages => {
  return 'isOverwriteAuthorWithCurrentUser' in opt;
};
