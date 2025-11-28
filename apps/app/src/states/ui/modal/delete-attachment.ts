import { useCallback } from 'react';
import type { IAttachmentHasId } from '@growi/core';
import { atom, useAtomValue, useSetAtom } from 'jotai';

type Remove = (body: { attachment_id: string }) => Promise<void>;

export type DeleteAttachmentModalStatus = {
  isOpened: boolean;
  attachment?: IAttachmentHasId;
  remove?: Remove;
};

export type DeleteAttachmentModalActions = {
  open: (attachment: IAttachmentHasId, remove: Remove) => void;
  close: () => void;
};

// Atom for delete attachment modal state
const deleteAttachmentModalAtom = atom<DeleteAttachmentModalStatus>({
  isOpened: false,
  attachment: undefined,
  remove: undefined,
});

/**
 * Hook for managing delete attachment modal state
 * Returns read-only modal status for optimal performance
 */
export const useDeleteAttachmentModalStatus =
  (): DeleteAttachmentModalStatus => {
    return useAtomValue(deleteAttachmentModalAtom);
  };

/**
 * Hook for managing delete attachment modal actions
 * Returns actions for opening and closing the modal with stable references
 */
export const useDeleteAttachmentModalActions =
  (): DeleteAttachmentModalActions => {
    const setStatus = useSetAtom(deleteAttachmentModalAtom);

    const open = useCallback(
      (attachment: IAttachmentHasId, remove: Remove) => {
        setStatus({ isOpened: true, attachment, remove });
      },
      [setStatus],
    );

    const close = useCallback(() => {
      setStatus({ isOpened: false, attachment: undefined, remove: undefined });
    }, [setStatus]);

    return { open, close };
  };
