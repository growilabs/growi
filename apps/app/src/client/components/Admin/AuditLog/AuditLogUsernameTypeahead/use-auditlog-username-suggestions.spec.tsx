import { renderHook } from '@testing-library/react';

import { useAuditLogUsernameSuggestions } from './use-auditlog-username-suggestions';

const mockUseSWRxAuditlogSuggestions = vi.hoisted(() => vi.fn());

vi.mock('~/stores/activity', () => ({
  useSWRxAuditlogSuggestions: mockUseSWRxAuditlogSuggestions,
}));

describe('useAuditLogUsernameSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the suggestions response to the injected-source contract', () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {
        username: { activeUsernames: ['alice'], inactiveUsernames: ['bob'] },
      },
      error: undefined,
      isLoading: false,
    });

    const { result } = renderHook(() => useAuditLogUsernameSuggestions('ali'));

    expect(mockUseSWRxAuditlogSuggestions).toHaveBeenCalledWith(
      'username',
      'ali',
    );
    expect(result.current).toEqual({
      activeUsernames: ['alice'],
      inactiveUsernames: ['bob'],
      isLoading: false,
    });
  });

  it('yields empty lists when the response carries no username field', () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {},
      error: undefined,
      isLoading: false,
    });

    const { result } = renderHook(() => useAuditLogUsernameSuggestions('ali'));

    expect(result.current.activeUsernames).toEqual([]);
    expect(result.current.inactiveUsernames).toEqual([]);
  });

  it('reports not-loading once the request has failed', () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: undefined,
      error: new Error('403 Forbidden'),
      isLoading: true,
    });

    const { result } = renderHook(() => useAuditLogUsernameSuggestions('ali'));

    expect(result.current.isLoading).toBe(false);
  });
});
