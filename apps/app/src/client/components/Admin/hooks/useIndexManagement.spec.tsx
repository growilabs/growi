import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';

import { useIndexManagement } from './useIndexManagement';

const mockApiv3Get = vi.hoisted(() => vi.fn());
const mockApiv3Put = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockUseAdminSocket = vi.hoisted(() => vi.fn());

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mockApiv3Get,
  apiv3Put: mockApiv3Put,
  apiv3Post: vi.fn(),
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: mockToastSuccess,
  toastError: mockToastError,
}));

vi.mock('~/features/admin/states/socket-io', () => ({
  useAdminSocket: mockUseAdminSocket,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider>{children}</Provider>
);

const defaultOptions = {
  statusEndpoint: '/search/auditlog-indices',
  progressSocketEvent: 'AddAuditlogProgress',
  finishSocketEvent: 'FinishAddAuditlog',
  failedSocketEvent: 'AuditlogRebuildingFailed',
  normalizationTimeoutMessage: 'timeout',
};

const makeStatusResponse = (isNormalized: boolean) => ({
  data: { info: { isNormalized, indices: null, aliases: null } },
});

describe('useIndexManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAdminSocket.mockReturnValue(null);
    mockApiv3Get.mockResolvedValue(makeStatusResponse(true));
    mockApiv3Put.mockResolvedValue({});
  });

  describe('retrieveStatus', () => {
    it('sets isConnected and isNormalized from API response', async () => {
      mockApiv3Get.mockResolvedValue(makeStatusResponse(false));
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));
      expect(result.current.isConnected).toBe(true);
      expect(result.current.isNormalized).toBe(false);
    });

    it('calls onStatusSuccess with response data', async () => {
      const onStatusSuccess = vi.fn();
      renderHook(
        () => useIndexManagement({ ...defaultOptions, onStatusSuccess }),
        { wrapper },
      );
      await waitFor(() =>
        expect(onStatusSuccess).toHaveBeenCalledWith(
          makeStatusResponse(true).data,
        ),
      );
    });

    it('sets isConnected to false on API error', async () => {
      mockApiv3Get.mockRejectedValue(new Error('Connection failed'));
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('isNormalizeEnabled', () => {
    it('is true when index is not normalized and service is connected', async () => {
      mockApiv3Get.mockResolvedValue(makeStatusResponse(false));
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));
      expect(result.current.isNormalizeEnabled).toBe(true);
    });

    it('is false when index is already normalized', async () => {
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));
      expect(result.current.isNormalizeEnabled).toBe(false);
    });
  });

  describe('isRebuildEnabled', () => {
    it('is true when index is normalized and service is connected', async () => {
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));
      expect(result.current.isRebuildEnabled).toBe(true);
    });

    it('is false when service is not connected', async () => {
      mockApiv3Get.mockRejectedValue(new Error('Not connected'));
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));
      expect(result.current.isRebuildEnabled).toBe(false);
    });
  });

  describe('normalizeIndices', () => {
    it('calls the normalize endpoint and shows success toast', async () => {
      mockApiv3Get.mockResolvedValue(makeStatusResponse(false));
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.normalizeIndices('Normalize succeeded');
      });

      expect(mockApiv3Put).toHaveBeenCalledWith('/search/auditlog-indices', {
        operation: 'normalize',
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('Normalize succeeded');
    });

    it('shows error toast and still refreshes status on failure', async () => {
      const error = new Error('Normalize failed');
      mockApiv3Put.mockRejectedValue(error);
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      const prevGetCallCount = mockApiv3Get.mock.calls.length;

      await act(async () => {
        await result.current.normalizeIndices('Normalize succeeded');
      });

      expect(mockToastError).toHaveBeenCalledWith(error);
      expect(mockApiv3Get.mock.calls.length).toBeGreaterThan(prevGetCallCount);
    });
  });

  describe('rebuildIndices', () => {
    it('calls the rebuild endpoint and shows success toast', async () => {
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.rebuildIndices('Rebuild requested');
      });

      expect(mockApiv3Put).toHaveBeenCalledWith('/search/auditlog-indices', {
        operation: 'rebuild',
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('Rebuild requested');
    });

    it('shows error toast and resets isRebuildingProcessing on failure', async () => {
      mockApiv3Put.mockRejectedValue(new Error('Rebuild failed'));
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      await act(async () => {
        await result.current.rebuildIndices('Rebuild requested');
      });

      expect(mockToastError).toHaveBeenCalled();
      expect(result.current.isRebuildingProcessing).toBe(false);
    });
  });

  describe('socket events', () => {
    const setupSocket = () => {
      const handlers: Record<string, (data: unknown) => unknown> = {};
      const socket = {
        on: vi.fn((event: string, handler: (data: unknown) => unknown) => {
          handlers[event] = handler;
        }),
        off: vi.fn(),
      };
      mockUseAdminSocket.mockReturnValue(socket);
      return handlers;
    };

    it('resets isRebuildingProcessing and shows error toast on failed event', async () => {
      const handlers = setupSocket();
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => {
        handlers['AddAuditlogProgress']?.({ totalCount: 100, count: 10 });
      });
      expect(result.current.isRebuildingProcessing).toBe(true);

      await act(async () => {
        await (
          handlers['AuditlogRebuildingFailed'] as (data: {
            error: string;
          }) => Promise<void>
        )?.({
          error: 'Rebuild failed',
        });
      });

      expect(result.current.isRebuildingProcessing).toBe(false);
      expect(mockToastError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('keeps isRebuildingProcessing on socket disconnect, since the rebuild continues server-side', async () => {
      const handlers = setupSocket();
      const { result } = renderHook(() => useIndexManagement(defaultOptions), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isInitialized).toBe(true));

      act(() => {
        handlers['AddAuditlogProgress']?.({ totalCount: 100, count: 10 });
      });
      expect(result.current.isRebuildingProcessing).toBe(true);

      act(() => {
        handlers['disconnect']?.({});
      });

      expect(result.current.isRebuildingProcessing).toBe(true);
    });
  });
});
