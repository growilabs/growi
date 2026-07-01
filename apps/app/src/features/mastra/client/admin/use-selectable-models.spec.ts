// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
// biome-ignore lint/style/noRestrictedImports: import only types
import type { AxiosResponse } from 'axios';
import { SWRConfig } from 'swr';
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
    mockedApiv3Get.mockResolvedValue(buildResponse({ modelIds: ['gpt-4o'] }));
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
    const response: SelectableModelsResponse = { modelIds: ['gpt-4o'] };
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
