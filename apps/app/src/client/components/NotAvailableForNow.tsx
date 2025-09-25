import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { NotAvailable } from './NotAvailable';


type NotAvailableForNowProps = {
  children: JSX.Element
}

export const NotAvailableForNow = React.memo(({ children }: NotAvailableForNowProps): JSX.Element => {
  const { t } = useTranslation();

  const title = t('Not available in this version');

  return (
    <NotAvailable
      isDisabled
      title={title}
      classNamePrefix="grw-not-available-for-now"
    >
      {children}
    </NotAvailable>
  );
});
NotAvailableForNow.displayName = 'NotAvailableForNow';
