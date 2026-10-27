// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
// biome-ignore lint/style/noRestrictedImports: import only types
import type { AxiosResponse } from 'axios';
import { SWRConfig } from 'swr';
import useSWRImmutable from 'swr/immutable';
import { vi } from 'vitest';

import * as apiv3Client from '~/client/util/apiv3-client';

import type { AiProvider } from '../../interfaces/ai-provider';
import type { SelectableModelsResponse } from '../../interfaces/selectable-models-response';
import { useSWRxSelectableModels } from './use-selectable-models';

vi.mock('~/client/util/apiv3-client');
const mockedApiv3Get = vi.spyOn(apiv3Client, 'apiv3Get');

const ENDPOINT = '/ai-settings/available-models';

const buildResponse = <T>(data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {} as AxiosResponse['config'],
});

// A promise whose resolution is controlled by the test, to hold a fetch in
// flight and observe the in-flight render deterministically.
const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// Fresh SWR cache per render so subscriptions never leak between tests.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    children,
  );

const renderUseSelectableModels = (provider: AiProvider | '' | undefined) =>
  renderHook(
    ({ provider }: { provider: AiProvider | '' | undefined }) =>
      useSWRxSelectableModels(provider),
    { wrapper, initialProps: { provider } },
  );

describe('useSWRxSelectableModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ models: [{ id: 'gpt-4o', name: 'GPT-4o' }] }),
    );
  });

  it('does not fetch while the provider is unset (Req 5.2)', async () => {
    // Act
    const { result } = renderUseSelectableModels('');

    // Assert: the null key suppresses the fetch entirely.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockedApiv3Get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('does not fetch while the provider is undefined — before the form seeds (Req 5.2)', async () => {
    // Before the AI-settings data resolves, useForm has no defaultValues, so
    // watch('provider') returns undefined (not ''). A `=== ''`-only guard would
    // let it through and fire a request with no provider query param → a 400.
    const { result } = renderUseSelectableModels(undefined);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockedApiv3Get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('fetches for the selected provider and returns the response body (Req 1.1, 3.2)', async () => {
    // Arrange
    const response: SelectableModelsResponse = {
      models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
    };
    mockedApiv3Get.mockResolvedValue(buildResponse(response));

    // Act
    const { result } = renderUseSelectableModels('openai');

    // Assert
    await waitFor(() => {
      expect(result.current.data).toEqual(response);
    });
    // The provider must be passed as the query-params object directly (single
    // wrap); a `{ params: { provider } }` shape would double-wrap the query.
    expect(mockedApiv3Get).toHaveBeenCalledWith(ENDPOINT, {
      provider: 'openai',
    });
  });

  it('refetches with the new provider when the provider changes (Req 5.1)', async () => {
    // Arrange
    const { result, rerender } = renderUseSelectableModels('openai');
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // Act: switch the provider — the SWR key changes, forcing a new fetch.
    rerender({ provider: 'anthropic' });

    // Assert: a fetch is issued for the new provider.
    await waitFor(() => {
      expect(mockedApiv3Get).toHaveBeenCalledWith(ENDPOINT, {
        provider: 'anthropic',
      });
    });
  });

  it('surfaces the fetch error without swallowing it (Req 3.2)', async () => {
    // Arrange: the container falls back to free-text on error, so the hook must
    // expose it rather than absorb it.
    const fetchError = new Error('failed to load models');
    mockedApiv3Get.mockRejectedValue(fetchError);

    // Act
    const { result } = renderUseSelectableModels('openai');

    // Assert
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe('invalidateAllProviders', () => {
  it('invalidates every visited provider list — including unmounted ones — leaving unrelated keys untouched', async () => {
    // This encodes the real regression scenario: the component mounts ONE
    // provider's hook at a time (keyed on the watched provider), and
    // useSWRImmutable disables all stale revalidation — so after a catalog
    // refresh, a provider visited earlier in the session would keep serving
    // its pre-refresh list from cache forever. An unrelated SWR key acts as
    // the control probe for over-invalidation.
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ models: [{ id: 'old-model', name: 'Old Model' }] }),
    );
    const unrelatedFetcher = vi.fn(async () => 'unrelated-data');

    const useHarness = ({ provider }: { provider: AiProvider }) => ({
      models: useSWRxSelectableModels(provider),
      unrelated: useSWRImmutable('unrelated-key', unrelatedFetcher),
    });
    const { result, rerender } = renderHook(useHarness, {
      wrapper,
      initialProps: { provider: 'openai' as AiProvider },
    });

    // openai visited and cached with the pre-refresh list...
    await waitFor(() => {
      expect(result.current.models.data).toEqual({
        models: [{ id: 'old-model', name: 'Old Model' }],
      });
    });
    // ...then the admin switches to anthropic (openai's hook unmounts).
    rerender({ provider: 'anthropic' });
    await waitFor(() => {
      expect(result.current.models.data).toEqual({
        models: [{ id: 'old-model', name: 'Old Model' }],
      });
    });
    expect(result.current.unrelated.data).toBe('unrelated-data');

    // The server-side snapshot changes — a catalog refresh replaces it for ALL
    // providers at once.
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ models: [{ id: 'new-model', name: 'New Model' }] }),
    );

    // Act: refresh while anthropic is the mounted provider.
    await act(async () => {
      await result.current.models.invalidateAllProviders();
    });

    // Assert: the mounted provider refetches immediately...
    await waitFor(() => {
      expect(result.current.models.data).toEqual({
        models: [{ id: 'new-model', name: 'New Model' }],
      });
    });

    // ...and switching back to the previously visited openai refetches too
    // (its cache entry was cleared), instead of serving the pre-refresh list.
    rerender({ provider: 'openai' });
    await waitFor(() => {
      expect(result.current.models.data).toEqual({
        models: [{ id: 'new-model', name: 'New Model' }],
      });
    });

    // The unrelated key was neither cleared nor refetched.
    expect(result.current.unrelated.data).toBe('unrelated-data');
    expect(unrelatedFetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the active provider data present while its refresh refetch is in flight (no flicker)', async () => {
    // The mounted provider's model control is a <select> only while its catalog
    // data is present; if a refresh cleared that data to undefined the control
    // would swap to free-text and back — a flicker that is visible in the browser
    // because the available-models refetch has real network latency. Hold the
    // refetch pending here to observe that in-flight state deterministically.
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ models: [{ id: 'old-model', name: 'Old Model' }] }),
    );
    const { result } = renderHook(
      ({ provider }: { provider: AiProvider }) =>
        useSWRxSelectableModels(provider),
      { wrapper, initialProps: { provider: 'anthropic' as AiProvider } },
    );
    await waitFor(() => {
      expect(result.current.data).toEqual({
        models: [{ id: 'old-model', name: 'Old Model' }],
      });
    });

    // Hold the refresh revalidation's fetch pending so the in-flight state is
    // observable (a mocked instant fetch would let React batch the transient
    // undefined away — the very reason this must be tested with a pending fetch).
    expect(mockedApiv3Get).toHaveBeenCalledTimes(1); // the initial mount fetch
    const pending = deferred<AxiosResponse<SelectableModelsResponse>>();
    mockedApiv3Get.mockReturnValueOnce(pending.promise);

    let invalidatePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      invalidatePromise = result.current.invalidateAllProviders();
    });

    // Wait until the active provider's refetch has actually been dispatched.
    await waitFor(() => {
      expect(mockedApiv3Get).toHaveBeenCalledTimes(2);
    });

    // Refetch still in flight: the active provider's data must NOT be cleared to
    // undefined (a blanket clear would show undefined here → flicker). It is kept
    // in place while the refreshed list loads.
    expect(result.current.data).toEqual({
      models: [{ id: 'old-model', name: 'Old Model' }],
    });

    // Completing the refetch swaps the list in place — old → new, no undefined.
    await act(async () => {
      pending.resolve(
        buildResponse({ models: [{ id: 'new-model', name: 'New Model' }] }),
      );
      await invalidatePromise;
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({
        models: [{ id: 'new-model', name: 'New Model' }],
      });
    });
  });
});
