import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

export type PresentationModalStatus = {
  isOpened: boolean;
};

export type PresentationModalActions = {
  open: () => void;
  close: () => void;
};

// Atom for presentation modal state
const presentationModalAtom = atom<PresentationModalStatus>({
  isOpened: false,
});

/**
 * Hook for managing presentation modal state
 * Returns read-only modal status for optimal performance
 */
export const usePresentationModalStatus = (): PresentationModalStatus => {
  return useAtomValue(presentationModalAtom);
};

/**
 * Hook for managing presentation modal actions
 * Returns actions for opening and closing the modal with stable references
 */
export const usePresentationModalActions = (): PresentationModalActions => {
  const setStatus = useSetAtom(presentationModalAtom);

  const open = useCallback(() => {
    setStatus({ isOpened: true });
  }, [setStatus]);

  const close = useCallback(() => {
    setStatus({ isOpened: false });
  }, [setStatus]);

  return { open, close };
};
