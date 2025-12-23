import React from 'react';

import { useTranslation } from 'next-i18next';

import { useCurrentUser } from '~/states/global';

import { AccessTokenSettings } from './AccessTokenSettings';
import { ApiTokenSettings } from './ApiTokenSettings';


const ApiSettings = React.memo((): JSX.Element => {

  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  const shouldHideAccessTokenSettings = currentUser == null || !currentUser?.readOnly;

  return (
    <>
      <div className="mt-4">
        <h2 className="border-bottom pb-2 my-4 fs-4">{ t('API Token Settings') }</h2>
        <ApiTokenSettings />
      </div>

      {shouldHideAccessTokenSettings && (
        <div className="mt-4">
          <h2 className="border-bottom pb-2 my-4 fs-4">{ t('Access Token Settings') }</h2>
          <AccessTokenSettings />
        </div>
      )}
    </>
  );
});

ApiSettings.displayName = 'ApiSettings';

export default ApiSettings;
