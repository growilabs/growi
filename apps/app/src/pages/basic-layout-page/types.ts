import type { ISidebarConfig } from '~/interfaces/sidebar-config.js';
import type { IUserUISettings } from '~/interfaces/user-ui-settings.js';

export type UserUISettingsProps = {
  userUISettings?: IUserUISettings;
};

export type SidebarConfigurationProps = {
  sidebarConfig: ISidebarConfig;
};

export type SearchConfigurationProps = {
  searchConfig: {
    isSearchServiceConfigured: boolean;
    isSearchServiceReachable: boolean;
    isSearchScopeChildrenAsDefault: boolean;
  };
};

export type BasicLayoutConfigurationProps = UserUISettingsProps &
  SidebarConfigurationProps &
  SearchConfigurationProps;
