import { useIsCommentActionBlockedForReadOnlyUser } from '~/client/components/NotAvailableForReadOnlyUser';
import { useIsGuestUser, useIsSharedUser } from '~/states/context';

/**
 * UI gating only; the server enforces authorization on its own.
 * @param isReadOnly the hosting view is read-only (share-link view, search preview)
 */
export const useCanReactToComments = (isReadOnly: boolean): boolean => {
  const isGuestUser = useIsGuestUser();
  const isSharedUser = useIsSharedUser();
  const isBlockedForReadOnlyUser = useIsCommentActionBlockedForReadOnlyUser();

  return !(
    isReadOnly ||
    isGuestUser ||
    isSharedUser ||
    isBlockedForReadOnlyUser
  );
};
