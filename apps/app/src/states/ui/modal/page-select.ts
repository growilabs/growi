import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { IPageForItem } from '~/interfaces/page';

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

// Atom for selected page in modal
const selectedPageAtom = atom<IPageForItem | null>(null);

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
  const setSelectedPage = useSetAtom(selectedPageAtom);

  const open = useCallback(
    (opts?: IPageSelectModalOption) => {
      setStatus({ isOpened: true, opts });
      setSelectedPage(null); // Reset selected page when modal opens
    },
    [setStatus, setSelectedPage],
  );

  const close = useCallback(() => {
    setStatus({ isOpened: false, opts: undefined });
    setSelectedPage(null); // Reset selected page when modal closes
  }, [setStatus, setSelectedPage]);

  return { open, close };
};

/**
 * Hook for getting selected page in modal
 */
export const useSelectedPageInModal = (): IPageForItem | null => {
  return useAtomValue(selectedPageAtom);
};

/**
 * Hook for selecting a page in modal
 */
export const useSelectPageInModal = (): ((page: IPageForItem) => void) => {
  const setSelectedPage = useSetAtom(selectedPageAtom);

  return useCallback(
    (page: IPageForItem) => {
      if (page.path == null) {
        return;
      }
      setSelectedPage(page);
    },
    [setSelectedPage],
  );
};
