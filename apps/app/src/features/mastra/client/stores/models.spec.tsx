// @vitest-environment happy-dom

import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

import { useSWRxChatModels } from './models';

// Mock the API boundary. The hook's contract is "GET /mastra/models, return
// response.data" — so we assert the resolved data shape, not the SWR internals.
const apiv3Get = vi.fn();
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: (...args: unknown[]) => apiv3Get(...args),
}));

// Fresh SWR cache per render so the global `/mastra/models` key does not leak
// resolved data between tests.
const wrapper = ({ children }: PropsWithChildren): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
);

beforeEach(() => {
  apiv3Get.mockReset();
});

describe('useSWRxChatModels', () => {
  it('fetches /mastra/models and returns { models, selectedModelId }', async () => {
    const data = {
      models: ['gpt-4o', 'gpt-4o-mini'],
      selectedModelId: 'gpt-4o-mini',
    };
    apiv3Get.mockResolvedValue({ data });

    const { result } = renderHook(() => useSWRxChatModels(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(data);
    });
    expect(apiv3Get).toHaveBeenCalledWith('/mastra/models');
  });

  it('exposes the single allowed model when only one is configured', async () => {
    const data = {
      models: ['gpt-4o'],
      selectedModelId: 'gpt-4o',
    };
    apiv3Get.mockResolvedValue({ data });

    const { result } = renderHook(() => useSWRxChatModels(), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.models).toHaveLength(1);
    });
    expect(result.current.data?.selectedModelId).toBe('gpt-4o');
  });
});
