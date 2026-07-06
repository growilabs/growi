import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';

import { apiv3Get, apiv3Post, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useAdminSocket } from '~/features/admin/states/socket-io';
import { isSearchServiceReachableAtom } from '~/states/server-configurations';

interface UseIndexManagementOptions {
  statusEndpoint: string;
  progressSocketEvent: string;
  finishSocketEvent: string;
  failedSocketEvent: string;
  normalizationTimeoutMessage: string;
  onStatusSuccess?: (data: unknown) => void;
}

export const useIndexManagement = ({
  statusEndpoint,
  progressSocketEvent,
  finishSocketEvent,
  failedSocketEvent,
  normalizationTimeoutMessage,
  onStatusSuccess,
}: UseIndexManagementOptions) => {
  const isSearchServiceReachable = useAtomValue(isSearchServiceReachableAtom);
  const socket = useAdminSocket();

  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isReconnectingProcessing, setIsReconnectingProcessing] =
    useState(false);
  const [isNormalizingProcessing, setIsNormalizingProcessing] = useState(false);
  const [isRebuildingProcessing, setIsRebuildingProcessing] = useState(false);
  const [isRebuildingCompleted, setIsRebuildingCompleted] = useState(false);
  const [isNormalized, setIsNormalized] = useState(false);
  const [indicesData, setIndicesData] = useState(null);
  const [aliasesData, setAliasesData] = useState(null);
  const [rebuildTotal, setRebuildTotal] = useState(0);
  const [rebuildCurrent, setRebuildCurrent] = useState(0);

  const retrieveStatus = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      try {
        const { data } = await apiv3Get(statusEndpoint);
        const { info } = data;
        setIsConnected(true);
        setIsConfigured(true);
        setIsNormalized(info.isNormalized);
        setIndicesData(info.indices);
        setAliasesData(info.aliases);
        onStatusSuccess?.(data);
        return info.isNormalized;
      } catch (errors: unknown) {
        setIsConnected(false);
        if (Array.isArray(errors)) {
          for (const error of errors) {
            if (
              (error as { code?: string }).code ===
              'search-service-unconfigured'
            ) {
              setIsConfigured(false);
            }
          }
          if (!opts?.silent) {
            toastError(errors as Error[]);
          }
        } else if (!opts?.silent) {
          toastError(
            errors instanceof Error ? errors : new Error(String(errors)),
          );
        }
        return false;
      } finally {
        setIsInitialized(true);
      }
    },
    [statusEndpoint, onStatusSuccess],
  );

  useEffect(() => {
    retrieveStatus();
  }, [retrieveStatus]);

  useEffect(() => {
    if (socket == null) return;

    const onProgress = (data: { totalCount: number; count: number }) => {
      setIsRebuildingProcessing(true);
      setRebuildTotal(data.totalCount);
      setRebuildCurrent(data.count);
    };

    const onFinish = async (data: { totalCount: number; count: number }) => {
      setRebuildTotal(data.totalCount);
      setRebuildCurrent(data.count);

      const maxRetries = 5;
      const retryDelay = 500;
      let succeeded = false;
      for (let i = 0; i < maxRetries; i++) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential retry polling requires sequential awaits
        const normalized = await retrieveStatus({ silent: true });
        if (normalized) {
          succeeded = true;
          break;
        }
        if (i < maxRetries - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));
        }
      }

      setIsRebuildingProcessing(false);
      if (succeeded) {
        setIsRebuildingCompleted(true);
      } else {
        toastError(new Error(normalizationTimeoutMessage));
      }
    };

    const onFailed = async (data: { error: string }) => {
      toastError(new Error(data.error));
      setIsRebuildingProcessing(false);
      await retrieveStatus({ silent: true });
    };

    socket.on(progressSocketEvent, onProgress);
    socket.on(finishSocketEvent, onFinish);
    socket.on(failedSocketEvent, onFailed);
    // No 'disconnect' handler: the rebuild keeps running server-side and the
    // finish/failed broadcast still reaches this socket after it auto-reconnects.
    // Clearing isRebuildingProcessing here would allow a concurrent rebuild.

    return () => {
      socket.off(progressSocketEvent, onProgress);
      socket.off(finishSocketEvent, onFinish);
      socket.off(failedSocketEvent, onFailed);
    };
  }, [
    retrieveStatus,
    socket,
    progressSocketEvent,
    finishSocketEvent,
    failedSocketEvent,
    normalizationTimeoutMessage,
  ]);

  const reconnect = async () => {
    setIsReconnectingProcessing(true);
    try {
      await apiv3Post('/search/connection');
    } catch (e) {
      toastError(e);
      setIsReconnectingProcessing(false);
      return;
    }
    window.location.reload();
  };

  const normalizeIndices = async (successMessage: string) => {
    setIsNormalizingProcessing(true);
    try {
      await apiv3Put(statusEndpoint, { operation: 'normalize' });
      toastSuccess(successMessage);
    } catch (e) {
      toastError(e);
    } finally {
      setIsNormalizingProcessing(false);
      await retrieveStatus({ silent: true });
    }
  };

  const rebuildIndices = async (requestedMessage: string) => {
    setIsRebuildingProcessing(true);
    setIsRebuildingCompleted(false);
    try {
      await apiv3Put(statusEndpoint, { operation: 'rebuild' });
      toastSuccess(requestedMessage);
      await retrieveStatus({ silent: true });
    } catch (e) {
      toastError(e);
      setIsRebuildingProcessing(false);
      await retrieveStatus({ silent: true });
    }
  };

  const isErrorOccuredOnSearchService = !isSearchServiceReachable;
  const isReconnectBtnEnabled =
    !isReconnectingProcessing &&
    (!isInitialized || !isConnected || isErrorOccuredOnSearchService);
  const isNormalizeEnabled =
    !isNormalized &&
    !isNormalizingProcessing &&
    !isRebuildingProcessing &&
    isConnected;
  const isRebuildEnabled =
    isNormalized &&
    !isRebuildingProcessing &&
    !isNormalizingProcessing &&
    isConnected;

  return {
    isInitialized,
    isConnected,
    isConfigured,
    isReconnectingProcessing,
    isNormalizingProcessing,
    isRebuildingProcessing,
    isRebuildingCompleted,
    isNormalized,
    indicesData,
    aliasesData,
    rebuildTotal,
    rebuildCurrent,
    isErrorOccuredOnSearchService,
    isReconnectBtnEnabled,
    isNormalizeEnabled,
    isRebuildEnabled,
    retrieveStatus,
    reconnect,
    normalizeIndices,
    rebuildIndices,
  };
};
