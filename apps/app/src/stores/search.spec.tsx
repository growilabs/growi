import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

import { createEmptyFilterState } from '~/features/search/client/utils/search-query';

const { apiGetMock } = vi.hoisted(() => ({ apiGetMock: vi.fn() }));

vi.mock('~/client/util/apiv1-client', () => ({
  apiGet: apiGetMock,
}));

import { useSWRxSearch } from './search';

const mockResult = { meta: { total: 1, hitsCount: 1 }, data: [] };

// Fresh SWR cache per render so cases do not leak retained data into each other.
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('useSWRxSearch', () => {
  beforeEach(() => {
    apiGetMock.mockResolvedValue(mockResult);
  });

  it('does not search and exposes no data when there is no keyword and no filters', () => {
    const { result } = renderHook(
      () =>
        useSWRxSearch('', null, {
          limit: 10,
          filters: createEmptyFilterState(),
        }),
      { wrapper },
    );

    // Nothing to search: no request, and no stale data retained from a prior run.
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('runs a filter-only search (no keyword) and returns its data', async () => {
    const { result } = renderHook(
      () =>
        useSWRxSearch('', null, {
          limit: 10,
          filters: { ...createEmptyFilterState(), authors: ['alice'] },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual(mockResult));
    expect(apiGetMock).toHaveBeenCalled();
  });
});
