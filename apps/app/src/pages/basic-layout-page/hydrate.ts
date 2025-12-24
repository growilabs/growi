import { useHydrateAtoms } from 'jotai/utils';

import {
  isSearchScopeChildrenAsDefaultAtom,
  isSearchServiceConfiguredAtom,
  isSearchServiceReachableAtom,
} from '~/states/server-configurations';
import { useHydrateSidebarAtoms } from '~/states/ui/sidebar/hydrate';

import type {
  SearchConfigurationProps,
  SidebarConfigurationProps,
  UserUISettingsProps,
} from './types';

/**
 * Hook for hydrating server configuration atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 */
export const useHydrateBasicLayoutConfigurationAtoms = (
  searchConfig: SearchConfigurationProps['searchConfig'] | undefined,
  sidebarConfig: SidebarConfigurationProps['sidebarConfig'] | undefined,
  userUISettings: UserUISettingsProps['userUISettings'] | undefined,
): void => {
  // Hydrate server configuration atoms with server-side data
  useHydrateAtoms(
    searchConfig == null
      ? []
      : [
          [
            isSearchServiceConfiguredAtom,
            searchConfig.isSearchServiceConfigured,
          ],
          [isSearchServiceReachableAtom, searchConfig.isSearchServiceReachable],
          [
            isSearchScopeChildrenAsDefaultAtom,
            searchConfig.isSearchScopeChildrenAsDefault,
          ],
        ],
  );

  useHydrateSidebarAtoms(sidebarConfig, userUISettings);
};
