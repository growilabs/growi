import { useCallback } from 'react';
import type { IPageToRenameWithMeta } from '@growi/core';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { OnRenamedFunction } from '../../../interfaces/ui';

// Type definitions to match the original implementation
export type IRenameModalOption = {
  onRenamed?: OnRenamedFunction;
};

export type RenameModalStatus = {
  isOpened: boolean;
  page?: IPageToRenameWithMeta;
  opts?: IRenameModalOption;
};

export type RenameModalActions = {
  open: (page?: IPageToRenameWithMeta, opts?: IRenameModalOption) => void;
  close: () => void;
};

// Atom for page rename modal
const pageRenameModalAtom = atom<RenameModalStatus>({
  isOpened: false,
});

/**
 * Hook for managing page rename modal state
 * Returns read-only modal status for optimal performance
 */
export const usePageRenameModalStatus = (): RenameModalStatus => {
  return useAtomValue(pageRenameModalAtom);
};

/**
 * Hook for managing page rename modal actions
 * Returns actions for opening and closing the modal
 */
export const usePageRenameModalActions = (): RenameModalActions => {
  const setStatus = useSetAtom(pageRenameModalAtom);

  const open = useCallback(
    (page?: IPageToRenameWithMeta, opts?: IRenameModalOption) => {
      setStatus({ isOpened: true, page, opts });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({ isOpened: false });
  }, [setStatus]);

  return {
    open,
    close,
  };
};
