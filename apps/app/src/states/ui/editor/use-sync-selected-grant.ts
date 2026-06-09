import { useEffect } from 'react';

import { useCurrentPageId } from '~/states/page';
import { useSWRxCurrentGrantData } from '~/stores/page';

import { toSelectedGrant, useSelectedGrant } from './selected-grant';

/**
 * Sync selectedGrantAtom with the current page's grant.
 *
 * The atom defaults to GRANT_PUBLIC and only becomes meaningful once it has been
 * initialized from the current page's actual grant. This initialization must run
 * from an always-mounted component: on mobile, GrantSelector is rendered only
 * inside a closed Modal and therefore never mounts, which previously left the atom
 * at GRANT_PUBLIC and silently re-published owner/group-restricted pages on save.
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
