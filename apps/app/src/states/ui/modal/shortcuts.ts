import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';

// Type definitions
export type ShortcutsModalStatus = {
  isOpened: boolean;
};

export type ShortcutsModalActions = {
  open: () => void;
  close: () => void;
};

// Atom for shortcuts modal
const shortcutsModalAtom = atom<ShortcutsModalStatus>({
  isOpened: false,
});

/**
 * Hook for managing shortcuts modal state
 * Returns read-only modal status for optimal performance
 */
export const useShortcutsModal = (): ShortcutsModalStatus => {
  return useAtomValue(shortcutsModalAtom);
};

/**
 * Hook for managing shortcuts modal actions
 * Returns actions for opening and closing the modal
 */
export const useShortcutsModalActions = (): ShortcutsModalActions => {
  const setStatus = useSetAtom(shortcutsModalAtom);

  const open = useCallback(() => {
    setStatus({ isOpened: true });
  }, [setStatus]);

  const close = useCallback(() => {
    setStatus({ isOpened: false });
  }, [setStatus]);

  return {
    open,
    close,
  };
};
