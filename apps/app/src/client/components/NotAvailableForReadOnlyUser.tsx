import type React from 'react';
import type { JSX } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { useIsReadOnlyUser } from '~/states/context';
import { isRomUserAllowedToCommentAtom } from '~/states/server-configurations';

import { NotAvailable } from './NotAvailable';

export const NotAvailableForReadOnlyUser: React.FC<{
  children: JSX.Element;
}> = ({ children }) => {
  const { t } = useTranslation();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isDisabled = !!isReadOnlyUser;
  const title = t('Not available for read only user');
  return (
    <NotAvailable
      isDisabled={isDisabled}
      title={title}
      classNamePrefix="grw-not-available-for-read-only-user"
    >
      {children}
    </NotAvailable>
  );
};
NotAvailableForReadOnlyUser.displayName = 'NotAvailableForReadOnlyUser';

/**
 * Same gate as `NotAvailableIfReadOnlyUserNotAllowedToComment`, for call
 * sites that need a boolean (e.g. disabling a dropdown item) rather than a
 * wrapping disable overlay.
 */
export const useIsCommentActionBlockedForReadOnlyUser = (): boolean => {
  const isReadOnlyUser = useIsReadOnlyUser();
  const isRomUserAllowedToComment = useAtomValue(isRomUserAllowedToCommentAtom);
  return !!isReadOnlyUser && !isRomUserAllowedToComment;
};

export const NotAvailableIfReadOnlyUserNotAllowedToComment: React.FC<{
  children: JSX.Element;
}> = ({ children }) => {
  const { t } = useTranslation();
  const isDisabled = useIsCommentActionBlockedForReadOnlyUser();
  const title = t('page_comment.comment_management_is_not_allowed');
  return (
    <NotAvailable
      isDisabled={isDisabled}
      title={title}
      classNamePrefix="grw-not-available-for-read-only-user"
    >
      {children}
    </NotAvailable>
  );
};
NotAvailableIfReadOnlyUserNotAllowedToComment.displayName =
  'NotAvailableIfReadOnlyUserNotAllowedToComment';
