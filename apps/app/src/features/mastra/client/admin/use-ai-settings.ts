import { useCallback } from 'react';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';

import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';

const KEY = '/ai-settings';

export interface UseAiSettings extends SWRResponse<AiSettingsResponse, Error> {
  /**
   * Persist the given AI settings via PUT and revalidate the fetched value.
   *
   * Throws on failure (the axios error is propagated) so the container can show
   * a toast and retain the in-progress input (R6.3); toast/state handling is
   * intentionally kept out of this hook.
   */
  save: (body: AiSettingsUpdateRequest) => Promise<void>;
}

export const useAiSettings = (): UseAiSettings => {
  const swr = useSWRImmutable<AiSettingsResponse, Error>(KEY, (endpoint) =>
    apiv3Get<AiSettingsResponse>(endpoint).then((res) => res.data),
  );

  const { mutate } = swr;

  const save = useCallback(
    async (body: AiSettingsUpdateRequest): Promise<void> => {
      await apiv3Put<AiSettingsResponse>(KEY, body);
      await mutate();
    },
    [mutate],
  );

  return { ...swr, save };
};
