import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useDeleteBookmarkFolderModalStatus } from '~/states/ui/modal/delete-bookmark-folder';

type DeleteBookmarkFolderModalProps = Record<string, unknown>;

export const DeleteBookmarkFolderModalLazyLoaded = (): JSX.Element => {
  const status = useDeleteBookmarkFolderModalStatus();

  const DeleteBookmarkFolderModal = useLazyLoader<DeleteBookmarkFolderModalProps>(
    'delete-bookmark-folder-modal',
    () => import('./DeleteBookmarkFolderModal').then(mod => ({ default: mod.DeleteBookmarkFolderModal })),
    status?.isOpened ?? false,
  );

  return DeleteBookmarkFolderModal ? <DeleteBookmarkFolderModal /> : <></>;
};
