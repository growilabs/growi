import { renderHook } from '@testing-library/react';

import {
  createEmptyFilterState,
  type SearchFilterState,
} from '~/features/search/client/utils/search-query';

// SWR fires a request for a non-null key and stays idle for a null one, so the
// key is the observable proxy for "does a search run?" — assert on it rather
// than on the internal shouldSearch/isFilterStateEmpty helpers.
const useSWRMock = vi.fn((..._args: unknown[]) => ({
  data: undefined,
  error: undefined,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
}));

vi.mock('swr', () => ({
  default: (...args: unknown[]) => useSWRMock(...args),
  mutate: vi.fn(),
}));

import { useSWRxSearch } from './search';

const baseConfig = { limit: 20 };

const withFilters = (
  overrides: Partial<SearchFilterState>,
): SearchFilterState => ({ ...createEmptyFilterState(), ...overrides });

const swrKeyFor = (
  keyword: string | null,
  filters?: SearchFilterState,
): unknown => {
  useSWRMock.mockClear();
  renderHook(() => useSWRxSearch(keyword, null, { ...baseConfig, filters }));
  return useSWRMock.mock.calls[0]?.[0];
};

describe('useSWRxSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runs a search (non-null SWR key)', () => {
    it('when a keyword is present and no filter is set', () => {
      expect(swrKeyFor('hello')).not.toBeNull();
    });

    it.each<[string, SearchFilterState]>([
      ['author', withFilters({ authors: ['alice'] })],
      ['editor', withFilters({ editors: ['bob'] })],
      ['group', withFilters({ groups: ['engineering'] })],
      ['tag', withFilters({ tags: ['release'] })],
    ])('when the keyword is empty but a %s filter is set (filter-only search)', (_field, filters) => {
      expect(swrKeyFor('', filters)).not.toBeNull();
    });

    it('when the keyword is null but a filter is set (filter-only search)', () => {
      expect(
        swrKeyFor(null, withFilters({ authors: ['alice'] })),
      ).not.toBeNull();
    });
  });

  describe('does not run a search (null SWR key)', () => {
    it('when the keyword is an empty string and no filter is set', () => {
      expect(swrKeyFor('')).toBeNull();
    });

    it('when the keyword is null and no filter is set', () => {
      expect(swrKeyFor(null)).toBeNull();
    });

    it('when the keyword is empty and every filter field is empty', () => {
      expect(swrKeyFor('', createEmptyFilterState())).toBeNull();
    });
  });
});
