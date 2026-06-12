import { useHydrateAtoms } from 'jotai/utils';

import {
  isSearchScopeChildrenAsDefaultAtom,
  isSearchServiceConfiguredAtom,
  isSearchServiceReachableAtom,
} from '~/states/server-configurations/index.js';
import { useHydrateSidebarAtoms } from '~/states/ui/sidebar/hydrate.js';
import { createAtomTuple } from '~/utils/jotai-utils.js';

import type {
  SearchConfigurationProps,
  SidebarConfigurationProps,
  UserUISettingsProps,
} from './types.js';

/**
 * Hook for hydrating server configuration atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 */
export const useHydrateBasicLayoutConfigurationAtoms = (
  searchConfig: SearchConfigurationProps['searchConfig'] | undefined,
  sidebarConfig: SidebarConfigurationProps['sidebarConfig'] | undefined,
  userUISettings: UserUISettingsProps['userUISettings'] | undefined,
): void => {
  const tuples =
    searchConfig == null
      ? []
      : [
          createAtomTuple(
            isSearchServiceConfiguredAtom,
            searchConfig.isSearchServiceConfigured,
          ),
          createAtomTuple(
            isSearchServiceReachableAtom,
            searchConfig.isSearchServiceReachable,
          ),
          createAtomTuple(
            isSearchScopeChildrenAsDefaultAtom,
            searchConfig.isSearchScopeChildrenAsDefault,
          ),
        ];

  useHydrateAtoms(tuples);

  useHydrateSidebarAtoms(sidebarConfig, userUISettings);
};
