import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { useDeleteBookmarkFolderModalStatus } from '~/states/ui/modal/delete-bookmark-folder.js';

type DeleteBookmarkFolderModalProps = Record<string, unknown>;

export const DeleteBookmarkFolderModalLazyLoaded = (): JSX.Element => {
  const status = useDeleteBookmarkFolderModalStatus();

  const DeleteBookmarkFolderModal =
    useLazyLoader<DeleteBookmarkFolderModalProps>(
      'delete-bookmark-folder-modal',
      () =>
        import('./DeleteBookmarkFolderModal.js').then((mod) => ({
          default: mod.DeleteBookmarkFolderModal,
        })),
      status?.isOpened ?? false,
    );

  return DeleteBookmarkFolderModal ? <DeleteBookmarkFolderModal /> : <></>;
};
