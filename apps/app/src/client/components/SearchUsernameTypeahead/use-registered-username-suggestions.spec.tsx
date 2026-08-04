import { renderHook } from '@testing-library/react';

import { useRegisteredUsernameSuggestions } from './use-registered-username-suggestions';

const mockUseSWRxUsernames = vi.hoisted(() => vi.fn());

vi.mock('~/stores/user', () => ({
  useSWRxUsernames: mockUseSWRxUsernames,
}));

describe('useRegisteredUsernameSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the usernames response to the injected-source contract', () => {
    mockUseSWRxUsernames.mockReturnValue({
      data: {
        activeUser: { usernames: ['alice'], totalCount: 1 },
        inactiveUser: { usernames: ['bob'], totalCount: 1 },
      },
      error: undefined,
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useRegisteredUsernameSuggestions('ali'),
    );

    expect(mockUseSWRxUsernames).toHaveBeenCalledWith('ali');
    expect(result.current).toEqual({
      activeUsernames: ['alice'],
      inactiveUsernames: ['bob'],
      isLoading: false,
    });
  });

  it('yields empty lists when the response omits a user group', () => {
    mockUseSWRxUsernames.mockReturnValue({
      data: { activeUser: { usernames: ['alice'], totalCount: 1 } },
      error: undefined,
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useRegisteredUsernameSuggestions('ali'),
    );

    expect(result.current.activeUsernames).toEqual(['alice']);
    expect(result.current.inactiveUsernames).toEqual([]);
  });

  it('reports not-loading once the request has failed', () => {
    mockUseSWRxUsernames.mockReturnValue({
      data: undefined,
      error: new Error('500'),
      isLoading: true,
    });

    const { result } = renderHook(() =>
      useRegisteredUsernameSuggestions('ali'),
    );

    expect(result.current.isLoading).toBe(false);
  });
});
