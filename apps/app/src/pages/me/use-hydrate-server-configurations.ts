import { useHydrateAtoms } from 'jotai/utils';

import {
  registrationWhitelistAtom,
  showPageLimitationXLAtom,
} from '~/states/server-configurations';

import type { ServerConfigurationProps } from './types';

/**
 * Hook for hydrating server configuration atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 */
export const useHydrateServerConfigurationAtoms = (
  serverConfig: ServerConfigurationProps['serverConfig'] | undefined,
): void => {
  // Hydrate server configuration atoms with server-side data
  useHydrateAtoms(
    serverConfig == null
      ? []
      : [
          [showPageLimitationXLAtom, serverConfig.showPageLimitationXL],
          [registrationWhitelistAtom, serverConfig.registrationWhitelist],
        ],
  );
};
