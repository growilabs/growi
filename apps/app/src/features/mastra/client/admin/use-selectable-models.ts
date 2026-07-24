import { useCallback } from 'react';
import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import { useSWRConfig } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';

// Type-only import: this hook needs only the AiProvider type, not the value set.
// (ai-provider is a client-safe, dependency-free module; other client files import
// its values freely — this one simply has no runtime use for them.)
import type { AiProvider } from '../../interfaces/ai-provider';
import type { SelectableModelsResponse } from '../../interfaces/selectable-models-response';

const ENDPOINT = '/ai-settings/available-models';

type SelectableModelsUtils = {
  /**
   * Invalidate EVERY cached selectable-models list (one per visited provider)
   * after a catalog refresh, which replaces the persisted snapshot for ALL
   * providers at once. Per-provider entries live under `[ENDPOINT, provider]`
   * keys cached by `useSWRImmutable`, which disables stale revalidation, so the
   * response's own bound `mutate` would refresh only the current provider.
   *
   * Two behaviours, by whether the provider's hook is mounted (the consumer
   * mounts one at a time):
   * - **Active provider** (mounted): revalidated IN PLACE — its data is kept
   *   while it refetches. Clearing it to `undefined` would make the mounted
   *   model control briefly lose its options and fall back to free-text (a
   *   `<select>`→`<text>` element swap = visible flicker on every refresh), so
   *   it is deliberately NOT cleared.
   * - **Other providers** (unmounted): CLEARED (`data: undefined`). A no-data
   *   revalidate can't refetch a key with no mounted hook, so clearing is what
   *   makes each refetch on its next mount (provider switch), same as its first
   *   visit.
   *
   * Unrelated SWR keys are untouched by the filter.
   */
  invalidateAllProviders: () => Promise<void>;
};

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
): SWRResponseWithUtils<
  SelectableModelsUtils,
  SelectableModelsResponse,
  Error
> => {
  const { mutate: mutateGlobal } = useSWRConfig();

  const swrResult = useSWRImmutable<SelectableModelsResponse, Error>(
    provider == null || provider === '' ? null : [ENDPOINT, provider],
    ([endpoint, p]: [string, AiProvider]) =>
      apiv3Get<SelectableModelsResponse>(endpoint, { provider: p }).then(
        (res) => res.data,
      ),
  );

  // See SelectableModelsUtils for the split: the ACTIVE provider is revalidated
  // in place (data kept) to avoid flicker, while the others are cleared so they
  // refetch on their next mount.
  const invalidateAllProviders = useCallback(async (): Promise<void> => {
    const active = provider == null || provider === '' ? null : provider;
    await Promise.all([
      // Non-active providers: CLEAR (data → undefined). Their hooks are not
      // mounted (one provider at a time), and useSWRImmutable won't auto-
      // revalidate a key with no mounted hook, so clearing is what makes each
      // refetch on its next mount (provider switch) — same as its first visit.
      mutateGlobal(
        (key) =>
          Array.isArray(key) &&
          key[0] === ENDPOINT &&
          (active == null || key[1] !== active),
        undefined,
        { revalidate: false },
      ),
      // Active (mounted) provider: revalidate IN PLACE — keep the current data
      // while refetching. Clearing it to `undefined` (as a blanket clear would)
      // makes the mounted model control momentarily lose its options and fall
      // back to free-text — a <select>→<text>→<select> element swap that flickers
      // on every refresh. Revalidating in place replaces the list with no
      // undefined window.
      active != null
        ? mutateGlobal(
            (key) =>
              Array.isArray(key) && key[0] === ENDPOINT && key[1] === active,
            undefined,
            // populateCache: false keeps the current data (do NOT write the
            // `undefined`), revalidate: true forces the refetch even for the
            // immutable key. Together: refetch in place, no undefined window.
            { revalidate: true, populateCache: false },
          )
        : Promise.resolve(),
    ]);
  }, [mutateGlobal, provider]);

  return withUtils(swrResult, { invalidateAllProviders });
};
