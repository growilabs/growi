import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { EditorMode } from '../editor';

/*
 * PageStatusAlert
 */
type OpenPageStatusAlertOptions = {
  hideEditorMode?: EditorMode;
  onRefleshPage?: () => void;
  onResolveConflict?: () => void;
};

export type PageStatusAlertStatus = {
  isOpen: boolean;
  hideEditorMode?: EditorMode;
  onRefleshPage?: () => void;
  onResolveConflict?: () => void;
};

export type PageStatusAlertActions = {
  open: (options: OpenPageStatusAlertOptions) => void;
  close: () => void;
};

// Atom definition
const pageStatusAlertAtom = atom<PageStatusAlertStatus>({
  isOpen: false,
});

// Status hook (read-only, optimized for performance)
export const usePageStatusAlertStatus = (): PageStatusAlertStatus => {
  return useAtomValue(pageStatusAlertAtom);
};

// Actions hook (write-only, optimized for performance)
export const usePageStatusAlertActions = (): PageStatusAlertActions => {
  const setStatus = useSetAtom(pageStatusAlertAtom);

  const open = useCallback(
    (options: OpenPageStatusAlertOptions) => {
      setStatus({ isOpen: true, ...options });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({ isOpen: false });
  }, [setStatus]);

  return { open, close };
};
