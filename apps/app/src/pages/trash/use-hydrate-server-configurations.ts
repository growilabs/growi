import { useHydrateAtoms } from 'jotai/utils';

import { showPageLimitationXLAtom } from '~/states/server-configurations/index.js';
import { createAtomTuple } from '~/utils/jotai-utils.js';

import type { ServerConfigurationProps } from './types.js';

/**
 * Hook for hydrating server configuration atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 */
export const useHydrateServerConfigurationAtoms = (
  serverConfig: ServerConfigurationProps['serverConfig'] | undefined,
): void => {
  const tuples =
    serverConfig == null
      ? []
      : [
          createAtomTuple(
            showPageLimitationXLAtom,
            serverConfig.showPageLimitationXL,
          ),
        ];

  useHydrateAtoms(tuples);
};
