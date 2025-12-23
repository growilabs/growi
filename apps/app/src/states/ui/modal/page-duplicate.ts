import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { OnDuplicatedFunction } from '../../../interfaces/ui';

// Type definitions to match the original implementation
export type IPageForPageDuplicateModal = {
  pageId: string;
  path: string;
};

export type IDuplicateModalOption = {
  onDuplicated?: OnDuplicatedFunction;
};

export type DuplicateModalStatus = {
  isOpened: boolean;
  page?: IPageForPageDuplicateModal;
  opts?: IDuplicateModalOption;
};

export type DuplicateModalActions = {
  open: (
    page?: IPageForPageDuplicateModal,
    opts?: IDuplicateModalOption,
  ) => void;
  close: () => void;
};

// Atom for page duplicate modal
const pageDuplicateModalAtom = atom<DuplicateModalStatus>({
  isOpened: false,
});

/**
 * Hook for managing page duplicate modal state
 * Returns read-only modal status for optimal performance
 */
export const usePageDuplicateModalStatus = (): DuplicateModalStatus => {
  return useAtomValue(pageDuplicateModalAtom);
};

/**
 * Hook for managing page duplicate modal actions
 * Returns actions for opening and closing the modal
 */
export const usePageDuplicateModalActions = (): DuplicateModalActions => {
  const setStatus = useSetAtom(pageDuplicateModalAtom);

  const open = useCallback(
    (page?: IPageForPageDuplicateModal, opts?: IDuplicateModalOption) => {
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
