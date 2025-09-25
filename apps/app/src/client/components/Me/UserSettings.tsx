import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { BasicInfoSettings } from './BasicInfoSettings';
import ProfileImageSettings from './ProfileImageSettings';

const UserSettings = React.memo((): JSX.Element => {
  const { t } = useTranslation();

  return (
    <div data-testid="grw-user-settings">
      <div className="mb-5">
        <h2 className="border-bottom fs-4 mt-4 pb-1">{t('Basic Info')}</h2>
        <BasicInfoSettings />
      </div>
      <div className="mb-5">
        <h2 className="border-bottom fs-4 mt-3 mt-md-5 pb-1">{t('Set Profile Image')}</h2>
        <ProfileImageSettings />
      </div>
    </div>
  );
});
UserSettings.displayName = 'UserSettings';

export default UserSettings;
