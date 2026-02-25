import { useCallback } from 'react';
import type { IPageToDeleteWithMeta } from '@growi/core';
import { atom, useAtomValue, useSetAtom } from 'jotai';

type IEmptyTrashModalOption = {
  onEmptiedTrash?: () => void;
  canDeleteAllPages: boolean;
};

export type EmptyTrashModalStatus = {
  isOpened: boolean;
  pages?: IPageToDeleteWithMeta[];
  opts?: IEmptyTrashModalOption;
};

export type EmptyTrashModalActions = {
  open: (
    pages?: IPageToDeleteWithMeta[],
    opts?: IEmptyTrashModalOption,
  ) => void;
  close: () => void;
};

// Atom for empty trash modal state
const emptyTrashModalAtom = atom<EmptyTrashModalStatus>({
  isOpened: false,
  pages: [],
});

/**
 * Hook for managing empty trash modal state
 * Returns read-only modal status for optimal performance
 * Used for displaying modal state without triggering unnecessary re-renders
 */
export const useEmptyTrashModalStatus = (): EmptyTrashModalStatus => {
  return useAtomValue(emptyTrashModalAtom);
};

/**
 * Hook for managing empty trash modal actions
 * Returns actions for opening and closing the modal with stable references
 * Optimized to prevent unnecessary re-renders in action-only components
 */
export const useEmptyTrashModalActions = (): EmptyTrashModalActions => {
  const setStatus = useSetAtom(emptyTrashModalAtom);

  const open = useCallback(
    (pages?: IPageToDeleteWithMeta[], opts?: IEmptyTrashModalOption) => {
      setStatus({ isOpened: true, pages, opts });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({ isOpened: false, pages: [], opts: undefined });
  }, [setStatus]);

  return { open, close };
};
