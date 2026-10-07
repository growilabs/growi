import { atom, useAtom } from 'jotai';

import type {
  IOptionsForUpdate,
  IPageGrantData,
  IPageSelectedGrant,
} from '~/interfaces/page';
import { UserGroupPageGrantStatus } from '~/interfaces/page';

/**
 * Atom for selected grant in page editor
 * Stores temporary grant selection before it's applied to the page.
 *
 * Defaults to null ("not yet loaded") — NOT GRANT_PUBLIC. The real grant is the
 * page's current grant (which, for a newly created page, is inherited from the
 * closest ancestor), supplied asynchronously by useSyncSelectedGrantWithCurrentPage.
 * A GRANT_PUBLIC default would let an early save publish a restricted page before
 * that value arrives — see [[use-sync-selected-grant]] and issue #11272.
 */
const selectedGrantAtom = atom<IPageSelectedGrant | null>(null);

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

/**
 * Build the grant-related params for a page update from the selected grant.
 *
 * When nothing is selected (null) — e.g. the grant has not loaded yet, or
 * GrantSelector never mounted on mobile — both fields are omitted (undefined),
 * so the update endpoint preserves the page's existing grant rather than
 * overwriting it with a stale default. See issue #11272.
 */
export const toPageUpdateGrantParams = (
  selectedGrant: IPageSelectedGrant | null,
): Pick<IOptionsForUpdate, 'grant' | 'userRelatedGrantUserGroupIds'> => ({
  grant: selectedGrant?.grant,
  userRelatedGrantUserGroupIds: selectedGrant?.userRelatedGrantedGroups,
});
