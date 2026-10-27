import { useEffect } from 'react';

import { useCurrentPageId } from '~/states/page';
import { useSWRxCurrentGrantData } from '~/stores/page';

import { toSelectedGrant, useSelectedGrant } from './selected-grant';

/**
 * Sync selectedGrantAtom with the current page's grant.
 *
 * The atom starts as null (unresolved); this fills it with the page's actual
 * grant so the editor reflects the real visibility. It must run from an
 * always-mounted component: on mobile, GrantSelector is rendered only inside a
 * closed Modal and therefore never mounts, so it cannot own this sync. (Saving
 * while the atom is still null omits the grant, so the server preserves it — the
 * pre-load race is handled separately in PageEditor's save path.)
 *
 * Call this once from an always-mounted editor component (e.g. SavePageControls).
 *
 * @see https://github.com/growilabs/growi/issues/11272
 */
export const useSyncSelectedGrantWithCurrentPage = (): void => {
  const currentPageId = useCurrentPageId();
  const { data } = useSWRxCurrentGrantData(currentPageId);
  const [, setSelectedGrant] = useSelectedGrant();

  const currentPageGrant = data?.grantData.currentPageGrant;

  useEffect(() => {
    if (currentPageGrant == null) return;
    setSelectedGrant(toSelectedGrant(currentPageGrant));
  }, [currentPageGrant, setSelectedGrant]);
};
