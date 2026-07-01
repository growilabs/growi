import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';

// Type-only import: the client must not pull the server-only provider module at
// runtime (it is a plain type union here).
import type { AiProvider } from '../../interfaces/ai-provider';
import type { SelectableModelsResponse } from '../../interfaces/selectable-models-response';

const ENDPOINT = '/ai-settings/available-models';

/**
 * Fetch the selectable models for the currently configured provider.
 *
 * While the provider is unset the SWR key is `null`, so no request is issued
 * (Req 5.2). The key embeds the provider, so switching providers changes the
 * cache key and triggers a refetch for the new provider (Req 5.1). The data is
 * static per provider, hence `useSWRImmutable`.
 *
 * The fetch `error` is surfaced (not swallowed) so the container can fall back
 * to free-text input without blocking save (Req 3.2).
 */
export const useSWRxSelectableModels = (
  provider: AiProvider | '',
): SWRResponse<SelectableModelsResponse, Error> => {
  return useSWRImmutable<SelectableModelsResponse, Error>(
    provider === '' ? null : [ENDPOINT, provider],
    ([endpoint, p]: [string, AiProvider]) =>
      apiv3Get<SelectableModelsResponse>(endpoint, { provider: p }).then(
        (res) => res.data,
      ),
  );
};
