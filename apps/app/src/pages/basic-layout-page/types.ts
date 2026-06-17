import type { ISidebarConfig } from '~/interfaces/sidebar-config';
import type { IUserUISettings } from '~/interfaces/user-ui-settings';

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

export type AiConfigurationProps = {
  // AI *usability* (enabled && configured), not the raw on/off toggle. Gates the
  // sidebar AI affordance, so it must be supplied on every page that renders the
  // sidebar — hence it lives in the basic-layout props shared by all of them.
  aiEnabled: boolean;
};

export type BasicLayoutConfigurationProps = UserUISettingsProps &
  SidebarConfigurationProps &
  SearchConfigurationProps &
  AiConfigurationProps;
