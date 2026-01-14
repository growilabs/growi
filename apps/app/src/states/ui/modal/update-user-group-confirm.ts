import { useCallback } from 'react';
import type { IUserGroupHasId } from '@growi/core';
import { atom, useAtomValue, useSetAtom } from 'jotai';

export type UpdateUserGroupConfirmModalStatus = {
  isOpened: boolean;
  targetGroup?: IUserGroupHasId;
  updateData?: Partial<IUserGroupHasId>;
  onConfirm?: (
    targetGroup: IUserGroupHasId,
    updateData: Partial<IUserGroupHasId>,
    forceUpdateParents: boolean,
  ) => Promise<void>;
};

export type UpdateUserGroupConfirmModalActions = {
  open: (
    targetGroup: IUserGroupHasId,
    updateData: Partial<IUserGroupHasId>,
    onConfirm?: (...args: unknown[]) => Promise<void>,
  ) => void;
  close: () => void;
};

// Atom for update user group confirm modal state
const updateUserGroupConfirmModalAtom = atom<UpdateUserGroupConfirmModalStatus>(
  {
    isOpened: false,
  },
);

/**
 * Hook for managing update user group confirm modal state
 * Returns read-only modal status for optimal performance
 */
export const useUpdateUserGroupConfirmModalStatus =
  (): UpdateUserGroupConfirmModalStatus => {
    return useAtomValue(updateUserGroupConfirmModalAtom);
  };

/**
 * Hook for managing update user group confirm modal actions
 * Returns actions for opening and closing the modal with stable references
 */
export const useUpdateUserGroupConfirmModalActions =
  (): UpdateUserGroupConfirmModalActions => {
    const setStatus = useSetAtom(updateUserGroupConfirmModalAtom);

    const open = useCallback(
      (
        targetGroup: IUserGroupHasId,
        updateData: Partial<IUserGroupHasId>,
        onConfirm?: (...args: unknown[]) => Promise<void>,
      ) => {
        setStatus({ isOpened: true, targetGroup, updateData, onConfirm });
      },
      [setStatus],
    );

    const close = useCallback(() => {
      setStatus({
        isOpened: false,
        targetGroup: undefined,
        updateData: undefined,
        onConfirm: undefined,
      });
    }, [setStatus]);

    return { open, close };
  };
