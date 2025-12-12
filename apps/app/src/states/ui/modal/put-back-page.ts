import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { OnPutBackedFunction } from '../../../interfaces/ui';

type IPageForPagePutBackModal = {
  pageId: string;
  path: string;
};

type IPutBackPageModalOption = {
  onPutBacked?: OnPutBackedFunction;
};

export type PutBackPageModalStatus = {
  isOpened: boolean;
  page?: IPageForPagePutBackModal;
  opts?: IPutBackPageModalOption;
};

export type PutBackPageModalActions = {
  open: (
    page: IPageForPagePutBackModal,
    opts?: IPutBackPageModalOption,
  ) => void;
  close: () => void;
};

// Atom for put back page modal state
const putBackPageModalAtom = atom<PutBackPageModalStatus>({
  isOpened: false,
  page: { pageId: '', path: '' },
});

/**
 * Hook for managing put back page modal state
 * Returns read-only modal status for optimal performance
 */
export const usePutBackPageModalStatus = (): PutBackPageModalStatus => {
  return useAtomValue(putBackPageModalAtom);
};

/**
 * Hook for managing put back page modal actions
 * Returns actions for opening and closing the modal with stable references
 */
export const usePutBackPageModalActions = (): PutBackPageModalActions => {
  const setStatus = useSetAtom(putBackPageModalAtom);

  const open = useCallback(
    (page: IPageForPagePutBackModal, opts?: IPutBackPageModalOption) => {
      setStatus({ isOpened: true, page, opts });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({
      isOpened: false,
      page: { pageId: '', path: '' },
      opts: undefined,
    });
  }, [setStatus]);

  return { open, close };
};
