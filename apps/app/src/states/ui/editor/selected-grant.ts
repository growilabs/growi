import { PageGrant } from '@growi/core/dist/interfaces';
import { atom, useAtom } from 'jotai';

import type { IPageGrantData, IPageSelectedGrant } from '~/interfaces/page';
import { UserGroupPageGrantStatus } from '~/interfaces/page';

/**
 * Atom for selected grant in page editor
 * Stores temporary grant selection before it's applied to the page
 */
const selectedGrantAtom = atom<IPageSelectedGrant | null>({
  grant: PageGrant.GRANT_PUBLIC,
});

/**
 * Hook for managing selected grant in page editor
 * Used for temporary grant selection before applying to the page
 */
export const useSelectedGrant = () => useAtom(selectedGrantAtom);

/**
 * Convert the page's current grant data (server-side shape) into the
 * IPageSelectedGrant shape held by the editor's selected-grant state.
 *
 * Pure function so it can be reused from both the sync hook
 * ([[use-sync-selected-grant]]) and GrantSelector's change handler.
 */
export const toSelectedGrant = (
  currentPageGrant: IPageGrantData,
): IPageSelectedGrant => {
  const userRelatedGrantedGroups =
    currentPageGrant.groupGrantData?.userRelatedGroups
      .filter((group) => group.status === UserGroupPageGrantStatus.isGranted)
      .map((group) => ({ item: group.id, type: group.type })) ?? [];

  return {
    grant: currentPageGrant.grant,
    userRelatedGrantedGroups,
  };
};
