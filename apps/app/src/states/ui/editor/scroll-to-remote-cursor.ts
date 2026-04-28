import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

type ScrollToRemoteCursorFn = (clientId: number) => void;

const scrollToRemoteCursorAtom = atom<ScrollToRemoteCursorFn | null>(null);

// Read-only hook
export const useScrollToRemoteCursor = (): ScrollToRemoteCursorFn | null => {
  return useAtomValue(scrollToRemoteCursorAtom);
};

// Setter hook — wraps function values to prevent Jotai from treating them as
// updater functions (Jotai calls setAtom(fn) as setAtom(prev => fn(prev))).
export const useSetScrollToRemoteCursor = (): ((
  fn: ScrollToRemoteCursorFn | null,
) => void) => {
  const setAtom = useSetAtom(scrollToRemoteCursorAtom);
  return useCallback(
    (fn: ScrollToRemoteCursorFn | null) => {
      setAtom(() => fn);
    },
    [setAtom],
  );
};
