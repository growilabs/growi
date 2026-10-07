import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

// Type definitions
export type CreateModalStatus = {
  isOpened: boolean;
  path?: string;
};

export type CreateModalActions = {
  open: (path?: string) => void;
  close: () => void;
};

// Atom for page create modal
const pageCreateModalAtom = atom<CreateModalStatus>({ isOpened: false });

/**
 * Hook for managing page create modal state
 * Returns read-only modal status for optimal performance
 * Used for creating new pages with optional path specification
 */
export const usePageCreateModalStatus = (): CreateModalStatus => {
  return useAtomValue(pageCreateModalAtom);
};

/**
 * Hook for managing page create modal actions
 * Returns actions for opening and closing the modal
 */
export const usePageCreateModalActions = (): CreateModalActions => {
  const setStatus = useSetAtom(pageCreateModalAtom);

  const open = useCallback(
    (path?: string) => {
      setStatus({ isOpened: true, path });
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
