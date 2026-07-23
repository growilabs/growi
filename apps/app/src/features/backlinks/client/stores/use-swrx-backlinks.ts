import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import { useIsGuestUser } from '~/states/context';

import type { IBacklink, IBacklinkResponse } from '../../interfaces/backlink';

export const useSWRxBacklinks = (
  pageId: string | null,
): SWRResponse<IBacklink[], Error> => {
  // Include isGuestUser in the key so a stale guest-mode cache is not reused after login
  const isGuestUser = useIsGuestUser();

  const key = pageId != null ? ['/page/backlinks', pageId, isGuestUser] : null;

  return useSWRImmutable(key, ([endpoint, pageId]: [string, string, boolean]) =>
    apiv3Get<IBacklinkResponse>(endpoint, { pageId }).then(
      (response) => response.data.backlinks,
    ),
  );
};
