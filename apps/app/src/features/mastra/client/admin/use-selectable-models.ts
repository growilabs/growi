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
 * (Req 5.2). "Unset" means both '' (form default) AND `undefined` — before the
 * AI-settings data resolves, `useForm` has no defaultValues so `watch('provider')`
 * returns `undefined`, not '', despite the form-value type. A plain `=== ''`
 * guard would let that `undefined` through, producing an SWR key of
 * `[ENDPOINT, undefined]`; the request would then drop the (undefined) query
 * param and hit the route with no `provider` → a 400. Guarding on nullish too
 * keeps the "no provider ⇒ no request" contract during that initial window.
 *
 * The key embeds the provider, so switching providers changes the cache key and
 * triggers a refetch for the new provider (Req 5.1). The data is static per
 * provider, hence `useSWRImmutable`.
 *
 * The fetch `error` is surfaced (not swallowed) so the container can fall back
 * to free-text input without blocking save (Req 3.2).
 */
export const useSWRxSelectableModels = (
  provider: AiProvider | '' | undefined,
): SWRResponse<SelectableModelsResponse, Error> => {
  return useSWRImmutable<SelectableModelsResponse, Error>(
    provider == null || provider === '' ? null : [ENDPOINT, provider],
    ([endpoint, p]: [string, AiProvider]) =>
      apiv3Get<SelectableModelsResponse>(endpoint, { provider: p }).then(
        (res) => res.data,
      ),
  );
};
