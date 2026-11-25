import { useEffect, useState } from 'react';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IErrorV3 } from '~/interfaces/errors/v3-error';

import type { BacklinksBackfillState } from '../../interfaces/page-link-backfill';

const ENDPOINT = '/backlinks-backfill';

// A failing run emits nothing on the admin socket, so an active run is re-read on this interval.
const ACTIVE_RUN_REFRESH_MS = 30_000;

const refreshIntervalFor = (state?: BacklinksBackfillState): number =>
  state?.status === 'requested' || state?.status === 'running'
    ? ACTIVE_RUN_REFRESH_MS
    : 0;

/** The backfill job state, for the admin settings (admin only). */
export const useSWRxBacklinksBackfillState = (): SWRResponse<
  BacklinksBackfillState,
  IErrorV3[]
> => {
  // A number, not SWR's function form: SWR consults that function only once polling has
  // started, and it cannot start while the first read is still pending.
  const [refreshInterval, setRefreshInterval] = useState(0);

  const response = useSWR(
    ENDPOINT,
    (endpoint: string) =>
      apiv3Get<{ state: BacklinksBackfillState }>(endpoint).then(
        (res) => res.data.state,
      ),
    { refreshInterval },
  );

  const wanted = refreshIntervalFor(response.data);
  useEffect(() => {
    setRefreshInterval(wanted);
  }, [wanted]);

  return response;
};
