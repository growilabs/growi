import React, { type JSX } from 'react';

import DefaultErrorPage from 'next/error';
import { useTranslation } from 'react-i18next';


export const ForbiddenPage = (): JSX.Element => {
  const { t } = useTranslation('admin');

  const errorMessage = t('forbidden_page.do_not_have_admin_permission');

  return (
    <>
      <DefaultErrorPage statusCode={403} title={errorMessage} />
    </>
  );
};
