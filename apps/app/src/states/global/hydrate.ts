import { useHydrateAtoms } from 'jotai/utils';

import type { CommonEachProps, CommonInitialProps } from '~/pages/common-props';

import { _atomsForHydration } from './global';

const {
  appTitleAtom,
  confidentialAtom,
  csrfTokenAtom,
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
  // Hydrate global atoms with server-side data
  useHydrateAtoms(
    commonInitialProps == null
      ? []
      : [
          [appTitleAtom, commonInitialProps.appTitle],
          [siteUrlAtom, commonInitialProps.siteUrl],
          [
            siteUrlWithEmptyValueWarnAtom,
            commonInitialProps.siteUrlWithEmptyValueWarn,
          ],
          [confidentialAtom, commonInitialProps.confidential],
          [growiVersionAtom, commonInitialProps.growiVersion],
          [isDefaultLogoAtom, commonInitialProps.isDefaultLogo],
          [customTitleTemplateAtom, commonInitialProps.customTitleTemplate],
          [growiCloudUriAtom, commonInitialProps.growiCloudUri],
          [
            growiAppIdForGrowiCloudAtom,
            commonInitialProps.growiAppIdForGrowiCloud,
          ],
          [forcedColorSchemeAtom, commonInitialProps.forcedColorScheme],
        ],
  );
};

/**
 * Hook for hydrating global UI state atoms with server-side data forcibly
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 * @param commonEachProps - Server-side common properties from getServerSideCommonEachProps
 */
export const useHydrateGlobalEachAtoms = (
  commonEachProps: CommonEachProps,
): void => {
  // Hydrate global atoms with server-side data
  useHydrateAtoms(
    [
      [csrfTokenAtom, commonEachProps.csrfToken],
      [currentPathnameAtom, commonEachProps.currentPathname],
      [currentUserAtom, commonEachProps.currentUser],
      [isMaintenanceModeAtom, commonEachProps.isMaintenanceMode],
    ],
    { dangerouslyForceHydrate: true },
  );
};
