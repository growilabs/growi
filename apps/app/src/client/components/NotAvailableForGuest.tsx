import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { useIsGuestUser } from '~/states/context';

import { NotAvailable } from './NotAvailable';

type NotAvailableForGuestProps = {
  children: JSX.Element
}

export const NotAvailableForGuest = React.memo(({ children }: NotAvailableForGuestProps): JSX.Element => {
  const { t } = useTranslation();
  const isGuestUser = useIsGuestUser();

  const isDisabled = !!isGuestUser;
  const title = t('Not available for guest');

  return (
    <NotAvailable
      isDisabled={isDisabled}
      title={title}
      classNamePrefix="grw-not-available-for-guest"
    >
      {children}
    </NotAvailable>
  );
});
NotAvailableForGuest.displayName = 'NotAvailableForGuest';
