import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

// Constants to match the original implementation
export const PageAccessoriesModalContents = {
  PageHistory: 'PageHistory',
  Attachment: 'Attachment',
  ShareLink: 'ShareLink',
} as const;
export type PageAccessoriesModalContents =
  (typeof PageAccessoriesModalContents)[keyof typeof PageAccessoriesModalContents];

// Type definitions to match the original implementation
export type PageAccessoriesModalStatus = {
  isOpened: boolean;
  activatedContents?: PageAccessoriesModalContents;
};

export type PageAccessoriesModalActions = {
  open: (activatedContents: PageAccessoriesModalContents) => void;
  close: () => void;
  selectContents: (activatedContents: PageAccessoriesModalContents) => void;
};

// Atom for page accessories modal
const pageAccessoriesModalAtom = atom<PageAccessoriesModalStatus>({
  isOpened: false,
});

/**
 * Hook for managing page accessories modal state
 * Returns read-only modal status for optimal performance
 */
export const usePageAccessoriesModalStatus = (): PageAccessoriesModalStatus => {
  return useAtomValue(pageAccessoriesModalAtom);
};

/**
 * Hook for managing page accessories modal actions
 * Returns actions for opening, closing, and selecting contents
 */
export const usePageAccessoriesModalActions =
  (): PageAccessoriesModalActions => {
    const setStatus = useSetAtom(pageAccessoriesModalAtom);

    const open = useCallback(
      (activatedContents: PageAccessoriesModalContents) => {
        setStatus({ isOpened: true, activatedContents });
      },
      [setStatus],
    );

    const close = useCallback(() => {
      setStatus({ isOpened: false });
    }, [setStatus]);

    const selectContents = useCallback(
      (activatedContents: PageAccessoriesModalContents) => {
        setStatus((current) => ({ ...current, activatedContents }));
      },
      [setStatus],
    );

    return {
      open,
      close,
      selectContents,
    };
  };
