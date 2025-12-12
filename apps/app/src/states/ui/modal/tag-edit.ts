import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

// Type definitions to match the original implementation
export type TagEditModalStatus = {
  isOpen: boolean;
  tags: string[];
  pageId: string;
  revisionId: string;
};

export type TagEditModalActions = {
  open: (tags: string[], pageId: string, revisionId: string) => void;
  close: () => void;
};

// Atom for tag edit modal
const tagEditModalAtom = atom<TagEditModalStatus>({
  isOpen: false,
  tags: [],
  pageId: '',
  revisionId: '',
});

/**
 * Hook for managing tag edit modal state
 * Returns read-only modal status for optimal performance
 */
export const useTagEditModalStatus = (): TagEditModalStatus => {
  return useAtomValue(tagEditModalAtom);
};

/**
 * Hook for managing tag edit modal actions
 * Returns actions for opening and closing the modal
 */
export const useTagEditModalActions = (): TagEditModalActions => {
  const setStatus = useSetAtom(tagEditModalAtom);

  const open = useCallback(
    (tags: string[], pageId: string, revisionId: string) => {
      setStatus({ isOpen: true, tags, pageId, revisionId });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({ isOpen: false, tags: [], pageId: '', revisionId: '' });
  }, [setStatus]);

  return {
    open,
    close,
  };
};
