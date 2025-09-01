import { useHydrateAtoms } from 'jotai/utils';

import type { RendererConfig } from '~/interfaces/services/renderer';
import {
  isSearchScopeChildrenAsDefaultAtom,
  isSearchServiceConfiguredAtom,
  isSearchServiceReachableAtom,
  rendererConfigAtom,
} from '~/states/server-configurations/server-configurations';

import type { ServerConfigurationProps } from './types';

/**
 * Hook for hydrating server configuration atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 */
export const useHydrateServerConfigurationAtoms = (
    serverConfig: ServerConfigurationProps['serverConfig'] | undefined,
    rendererConfigs: RendererConfig | undefined,
): void => {
  // Hydrate server configuration atoms with server-side data
  useHydrateAtoms(serverConfig == null || rendererConfigs == null ? [] : [
    [isSearchServiceConfiguredAtom, serverConfig.isSearchServiceConfigured],
    [isSearchServiceReachableAtom, serverConfig.isSearchServiceReachable],
    [isSearchScopeChildrenAsDefaultAtom, serverConfig.isSearchScopeChildrenAsDefault],
    [rendererConfigAtom, rendererConfigs],
  ]);
};
