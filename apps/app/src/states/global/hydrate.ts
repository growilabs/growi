import { useHydrateAtoms } from 'jotai/utils';

import type { CommonEachProps, CommonInitialProps } from '~/pages/common-props';
import { createAtomTuple } from '~/utils/jotai-utils';

import { _atomsForHydration } from './global';

const {
  appTitleAtom,
  confidentialAtom,
  currentPathnameAtom,
  currentUserAtom,
  customTitleTemplateAtom,
  forcedColorSchemeAtom,
  growiAppIdForGrowiCloudAtom,
  growiCloudUriAtom,
  growiVersionAtom,
  isDefaultLogoAtom,
  isMaintenanceModeAtom,
  siteUrlAtom,
  siteUrlWithEmptyValueWarnAtom,
} = _atomsForHydration;

/**
 * Hook for hydrating global UI state atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 *
 * @param commonInitialProps - Server-side common properties from getServerSideCommonInitialProps
 */
export const useHydrateGlobalInitialAtoms = (
  commonInitialProps: CommonInitialProps | undefined,
): void => {
  const tuples =
    commonInitialProps == null
      ? []
      : [
          createAtomTuple(appTitleAtom, commonInitialProps.appTitle),
          createAtomTuple(siteUrlAtom, commonInitialProps.siteUrl),
          createAtomTuple(
            siteUrlWithEmptyValueWarnAtom,
            commonInitialProps.siteUrlWithEmptyValueWarn,
          ),
          createAtomTuple(confidentialAtom, commonInitialProps.confidential),
          createAtomTuple(growiVersionAtom, commonInitialProps.growiVersion),
          createAtomTuple(isDefaultLogoAtom, commonInitialProps.isDefaultLogo),
          createAtomTuple(
            customTitleTemplateAtom,
            commonInitialProps.customTitleTemplate,
          ),
          createAtomTuple(growiCloudUriAtom, commonInitialProps.growiCloudUri),
          createAtomTuple(
            growiAppIdForGrowiCloudAtom,
            commonInitialProps.growiAppIdForGrowiCloud,
          ),
          createAtomTuple(
            forcedColorSchemeAtom,
            commonInitialProps.forcedColorScheme,
          ),
        ];

  useHydrateAtoms(tuples);
};

/**
 * Hook for hydrating global UI state atoms with server-side data forcibly
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 * @param commonEachProps - Server-side common properties from getServerSideCommonEachProps
 */
export const useHydrateGlobalEachAtoms = (
  commonEachProps: CommonEachProps,
): void => {
  const tuples = [
    createAtomTuple(currentPathnameAtom, commonEachProps.currentPathname),
    createAtomTuple(currentUserAtom, commonEachProps.currentUser),
    createAtomTuple(isMaintenanceModeAtom, commonEachProps.isMaintenanceMode),
  ];

  useHydrateAtoms(tuples, { dangerouslyForceHydrate: true });
};
