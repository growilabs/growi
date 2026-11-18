import {
  isMovablePage,
  isTrashPage,
} from '@growi/core/dist/utils/page-path-utils';

// The pages a person can move: isMovablePage gates the rename control, and a page
// in the trash shows no page management at all (useIsAbleToShowPageManagement),
// so it comes back only through a restore.
export const isMovableSourcePath = (path: string): boolean =>
  isMovablePage(path) && !isTrashPage(path);
