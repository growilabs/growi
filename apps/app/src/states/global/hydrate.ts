import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
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
  // Initial hydration: ensure atoms are populated before children read them on first render
  const tuples = [
    createAtomTuple(currentPathnameAtom, commonEachProps.currentPathname),
    createAtomTuple(currentUserAtom, commonEachProps.currentUser),
    createAtomTuple(isMaintenanceModeAtom, commonEachProps.isMaintenanceMode),
  ];
  useHydrateAtoms(tuples);

  // Subsequent sync (e.g. route transitions): run in effect to avoid
  // "setState during render of a different component" warnings
  const setCurrentPathname = useSetAtom(currentPathnameAtom);
  const setCurrentUser = useSetAtom(currentUserAtom);
  const setIsMaintenanceMode = useSetAtom(isMaintenanceModeAtom);

  useEffect(() => {
    setCurrentPathname(commonEachProps.currentPathname);
  }, [commonEachProps.currentPathname, setCurrentPathname]);

  useEffect(() => {
    setCurrentUser(commonEachProps.currentUser);
  }, [commonEachProps.currentUser, setCurrentUser]);

  useEffect(() => {
    setIsMaintenanceMode(commonEachProps.isMaintenanceMode);
  }, [commonEachProps.isMaintenanceMode, setIsMaintenanceMode]);
};
