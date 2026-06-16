import { useHydrateAtoms } from 'jotai/utils';

import type { RendererConfig } from '~/interfaces/services/renderer';
import {
  disableUserPagesAtom,
  isContainerFluidAtom,
  rendererConfigAtom,
  showPageLimitationLAtom,
} from '~/states/server-configurations';
import { createAtomTuple } from '~/utils/jotai-utils';

import type { ServerConfigurationProps } from './types';

/**
 * Hook for hydrating server configuration atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 */
export const useHydrateServerConfigurationAtoms = (
  serverConfig: ServerConfigurationProps['serverConfig'] | undefined,
  rendererConfigs: RendererConfig | undefined,
): void => {
  const tuples =
    serverConfig == null || rendererConfigs == null
      ? []
      : [
          createAtomTuple(isContainerFluidAtom, serverConfig.isContainerFluid),
          createAtomTuple(
            showPageLimitationLAtom,
            serverConfig.showPageLimitationL,
          ),
          createAtomTuple(rendererConfigAtom, rendererConfigs),
          createAtomTuple(disableUserPagesAtom, serverConfig.disableUserPages),
        ];

  useHydrateAtoms(tuples);
};
