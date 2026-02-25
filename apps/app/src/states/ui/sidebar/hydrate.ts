import { useHydrateAtoms } from 'jotai/utils';

import type { ISidebarConfig } from '../../../interfaces/sidebar-config';
import { SidebarContentsType } from '../../../interfaces/ui';
import type { IUserUISettings } from '../../../interfaces/user-ui-settings';
import {
  currentProductNavWidthAtom,
  currentSidebarContentsAtom,
  preferCollapsedModeAtom,
} from './sidebar';

/**
 * Hook for hydrating sidebar-related UI state atoms with server-side data
 * This should be called early in page components to ensure atoms are properly initialized before rendering
 *
 * @param sidebarConfig - Server-side sidebar configuration
 * @param userUISettings - User's UI settings from database (optional)
 */
export const useHydrateSidebarAtoms = (
  sidebarConfig?: ISidebarConfig,
  userUISettings?: IUserUISettings,
): void => {
  useHydrateAtoms([
    // Use user preference from DB if available, otherwise use system default
    [
      preferCollapsedModeAtom,
      userUISettings?.preferCollapsedModeByUser ??
        sidebarConfig?.isSidebarCollapsedMode ??
        false,
    ],

    // Sidebar contents type (with default fallback)
    [
      currentSidebarContentsAtom,
      userUISettings?.currentSidebarContents ?? SidebarContentsType.TREE,
    ],

    // Product navigation width (with default fallback)
    [currentProductNavWidthAtom, userUISettings?.currentProductNavWidth ?? 320],
  ]);
};
