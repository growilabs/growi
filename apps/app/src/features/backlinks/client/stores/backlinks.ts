import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IErrorV3 } from '~/interfaces/errors/v3-error';
import { useIsGuestUser } from '~/states/context';

import type { IBacklink, IBacklinkResponse } from '../../interfaces/backlink';

// The error type is IErrorV3[], not Error: apiv3Request rejects with the apiv3
// error array (`throw errors`), so consumers receive a list, never an instance.
export const useSWRxBacklinks = (
  pageId: string | null,
): SWRResponse<IBacklink[], IErrorV3[]> => {
  // Include isGuestUser in the key so a stale guest-mode cache is not reused after login
  const isGuestUser = useIsGuestUser();

  const key = pageId != null ? ['/page/backlinks', pageId, isGuestUser] : null;

  // Plain useSWR (not useSWRImmutable): grants can change while pageId and the
  // user stay the same, so a reopened panel must revalidate the stale cache
  // instead of serving it for the rest of the session.
  return useSWR(key, ([endpoint, pageId]: [string, string, boolean]) =>
    apiv3Get<IBacklinkResponse>(endpoint, { pageId }).then(
      (response) => response.data.backlinks,
    ),
  );
};
