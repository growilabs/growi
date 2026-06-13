import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option.js';
import { isImportOptionForPages } from '~/models/admin/import-option-for-pages.js';

import type { OverwriteParams } from '../import-settings.js';
import { overwriteParams as overwriteParamsForAttachmentFilesChunks } from './attachmentFiles.chunks.js';
import { generateOverwriteParams as generateForPages } from './pages.js';
import { generateOverwriteParams as generateForRevisions } from './revisions.js';

/**
 * generate overwrite params with overwrite-params/* modules
 */
export const generateOverwriteParams = <OPT extends GrowiArchiveImportOption>(
  collectionName: string,
  operatorUserId: string,
  option: OPT,
): OverwriteParams => {
  switch (collectionName) {
    case 'pages':
      if (!isImportOptionForPages(option)) {
        throw new Error('Invalid option for pages');
      }
      return generateForPages(operatorUserId, option);
    case 'revisions':
      if (!isImportOptionForPages(option)) {
        throw new Error('Invalid option for revisions');
      }
      return generateForRevisions(operatorUserId, option);
    case 'attachmentFiles.chunks':
      return overwriteParamsForAttachmentFilesChunks;
    default:
      return {};
  }
};
