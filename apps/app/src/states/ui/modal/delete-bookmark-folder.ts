import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { BookmarkFolderItems } from '../../../interfaces/bookmark-info';
import type { onDeletedBookmarkFolderFunction } from '../../../interfaces/ui';

type IDeleteBookmarkFolderModalOption = {
  onDeleted?: onDeletedBookmarkFolderFunction;
};

export type DeleteBookmarkFolderModalStatus = {
  isOpened: boolean;
  bookmarkFolder?: BookmarkFolderItems;
  opts?: IDeleteBookmarkFolderModalOption;
};

export type DeleteBookmarkFolderModalActions = {
  open: (
    bookmarkFolder?: BookmarkFolderItems,
    opts?: IDeleteBookmarkFolderModalOption,
  ) => void;
  close: () => void;
};

// Atom for delete bookmark folder modal state
const deleteBookmarkFolderModalAtom = atom<DeleteBookmarkFolderModalStatus>({
  isOpened: false,
});

/**
 * Hook for managing delete bookmark folder modal state
 * Returns read-only modal status for optimal performance
 */
export const useDeleteBookmarkFolderModalStatus =
  (): DeleteBookmarkFolderModalStatus => {
    return useAtomValue(deleteBookmarkFolderModalAtom);
  };

/**
 * Hook for managing delete bookmark folder modal actions
 * Returns actions for opening and closing the modal with stable references
 */
export const useDeleteBookmarkFolderModalActions =
  (): DeleteBookmarkFolderModalActions => {
    const setStatus = useSetAtom(deleteBookmarkFolderModalAtom);

    const open = useCallback(
      (
        bookmarkFolder?: BookmarkFolderItems,
        opts?: IDeleteBookmarkFolderModalOption,
      ) => {
        setStatus({ isOpened: true, bookmarkFolder, opts });
      },
      [setStatus],
    );

    const close = useCallback(() => {
      setStatus({
        isOpened: false,
        bookmarkFolder: undefined,
        opts: undefined,
      });
    }, [setStatus]);

    return { open, close };
  };
