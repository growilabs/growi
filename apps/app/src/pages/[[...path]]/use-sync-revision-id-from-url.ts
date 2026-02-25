import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSetAtom } from 'jotai';

import { _atomsForSyncRevisionIdFromUrl } from '~/states/page';

const { revisionIdFromUrlAtom } = _atomsForSyncRevisionIdFromUrl;

/**
 * Sync URL query parameter (revisionId) to Jotai atom
 * This hook should be called in the main page component to keep the atom in sync with the URL
 */
export const useSyncRevisionIdFromUrl = (): void => {
  const router = useRouter();
  const setRevisionIdFromUrl = useSetAtom(revisionIdFromUrlAtom);

  useEffect(() => {
    const revisionId = router.query.revisionId;
    setRevisionIdFromUrl(
      typeof revisionId === 'string' ? revisionId : undefined,
    );
  }, [router.query.revisionId, setRevisionIdFromUrl]);
};
