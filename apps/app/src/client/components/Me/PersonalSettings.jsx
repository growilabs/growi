import React, { useMemo } from 'react';
import { useTranslation } from 'next-i18next';

import CustomNavAndContents from '../CustomNavigation/CustomNavAndContents.js';
import ApiSettings from './ApiSettings.js';
// import { EditorSettings } from './EditorSettings';
import ExternalAccountLinkedMe from './ExternalAccountLinkedMe.js';
import InAppNotificationSettings from './InAppNotificationSettings.js';
import OtherSettings from './OtherSettings.js';
import PasswordSettings from './PasswordSettings.js';
import UserSettings from './UserSettings.js';

const UserInformationIcon = () => (
  <span
    data-testid="user-infomation-tab-button"
    className="material-symbols-outlined"
  >
    person
  </span>
);

const ExternalAccountsIcon = () => (
  <span
    data-testid="external-accounts-tab-button"
    className="material-symbols-outlined"
  >
    ungroup
  </span>
);

const PasswordSettingsIcon = () => (
  <span
    data-testid="password-settings-tab-button"
    className="material-symbols-outlined"
  >
    password
  </span>
);

const ApiSettingsIcon = () => (
  <span
    data-testid="api-settings-tab-button"
    className="material-symbols-outlined"
  >
    api
  </span>
);

const InAppNotificationSettingsIcon = () => (
  <span
    data-testid="in-app-notification-settings-tab-button"
    className="material-symbols-outlined"
  >
    notifications
  </span>
);

const OtherSettingsIcon = () => (
  <span
    data-testid="other-settings-tab-button"
    className="material-symbols-outlined"
  >
    settings
  </span>
);

const PersonalSettings = () => {
  const { t } = useTranslation();

  const navTabMapping = useMemo(() => {
    return {
      user_infomation: {
        Icon: UserInformationIcon,
        Content: UserSettings,
        i18n: t('User Information'),
      },
      external_accounts: {
        Icon: ExternalAccountsIcon,
        Content: ExternalAccountLinkedMe,
        i18n: t('admin:user_management.external_accounts'),
      },
      password_settings: {
        Icon: PasswordSettingsIcon,
        Content: PasswordSettings,
        i18n: t('Password Settings'),
      },
      api_settings: {
        Icon: ApiSettingsIcon,
        Content: ApiSettings,
        i18n: t('API Settings'),
      },
      // editor_settings: {
      //   Icon: () => <span className="material-symbols-outlined">edit</span>,
      //   Content: EditorSettings,
      //   i18n: t('editor_settings.editor_settings'),
      // },
      in_app_notification_settings: {
        Icon: InAppNotificationSettingsIcon,
        Content: InAppNotificationSettings,
        i18n: t('in_app_notification_settings.in_app_notification_settings'),
      },
      other_settings: {
        Icon: OtherSettingsIcon,
        Content: OtherSettings,
        i18n: t('Other Settings'),
      },
    };
  }, [t]);

  const getDefaultTabIndex = () => {
    // e.g) '/me#password_settings' sets password settings tab as default
    const tab = window.location.hash?.substring(1);
    let defaultTabIndex;
    Object.keys(navTabMapping).forEach((key, i) => {
      if (key === tab) {
        defaultTabIndex = i;
      }
    });
    return defaultTabIndex;
  };

  return (
    <div data-testid="grw-personal-settings">
      <CustomNavAndContents
        defaultTabIndex={getDefaultTabIndex()}
        navTabMapping={navTabMapping}
        navigationMode="both"
        tabContentClasses={['px-0']}
      />
    </div>
  );
};

export default PersonalSettings;
