import { useCallback } from 'react';
import type { IPageToDeleteWithMeta } from '@growi/core';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { OnDeletedFunction } from '../../../interfaces/ui';

// Type definitions
export type IDeleteModalOption = {
  onDeleted?: OnDeletedFunction;
};

export type DeleteModalStatus = {
  isOpened: boolean;
  pages?: IPageToDeleteWithMeta[];
  opts?: IDeleteModalOption;
};

export type DeleteModalActions = {
  open: (pages?: IPageToDeleteWithMeta[], opts?: IDeleteModalOption) => void;
  close: () => void;
};

// Atom for page delete modal
const pageDeleteModalAtom = atom<DeleteModalStatus>({
  isOpened: false,
  pages: [],
});

/**
 * Hook for managing page delete modal state
 * Returns read-only modal status for optimal performance
 * Used for deleting single or multiple pages
 */
export const usePageDeleteModalStatus = (): DeleteModalStatus => {
  return useAtomValue(pageDeleteModalAtom);
};

/**
 * Hook for managing page delete modal actions
 * Returns actions for opening and closing the modal
 */
export const usePageDeleteModalActions = (): DeleteModalActions => {
  const setStatus = useSetAtom(pageDeleteModalAtom);

  const open = useCallback(
    (pages?: IPageToDeleteWithMeta[], opts?: IDeleteModalOption) => {
      setStatus({ isOpened: true, pages, opts });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({ isOpened: false, pages: [] });
  }, [setStatus]);

  return {
    open,
    close,
  };
};
