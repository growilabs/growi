import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { OnSelectedFunction } from '../../../interfaces/ui';

type IPageSelectModalOption = {
  isHierarchicalSelectionMode?: boolean;
  onSelected?: OnSelectedFunction;
};

export type PageSelectModalStatus = {
  isOpened: boolean;
  opts?: IPageSelectModalOption;
};

export type PageSelectModalActions = {
  open: (opts?: IPageSelectModalOption) => void;
  close: () => void;
};

// Atom for page select modal state
const pageSelectModalAtom = atom<PageSelectModalStatus>({
  isOpened: false,
});

/**
 * Hook for managing page select modal state
 * Returns read-only modal status for optimal performance
 */
export const usePageSelectModalStatus = (): PageSelectModalStatus => {
  return useAtomValue(pageSelectModalAtom);
};

/**
 * Hook for managing page select modal actions
 * Returns actions for opening and closing the modal with stable references
 */
export const usePageSelectModalActions = (): PageSelectModalActions => {
  const setStatus = useSetAtom(pageSelectModalAtom);

  const open = useCallback(
    (opts?: IPageSelectModalOption) => {
      setStatus({ isOpened: true, opts });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({ isOpened: false, opts: undefined });
  }, [setStatus]);

  return { open, close };
};
