import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import { apiv3Get } from '../../../client/util/apiv3-client';
import type { CurrentPageYjsData } from '../../../interfaces/yjs';
import { useCurrentPageId } from '../../../states/page';

// ============================================================================
// Atoms
// ============================================================================

const currentPageYjsDataAtom = atom<CurrentPageYjsData | undefined>(undefined);
const currentPageYjsDataLoadingAtom = atom<boolean>(false);
const currentPageYjsDataErrorAtom = atom<Error | undefined>(undefined);

// ============================================================================
// Read Hooks
// ============================================================================

/**
 * Hook to get current page Yjs data
 */
export const useCurrentPageYjsData = (): CurrentPageYjsData | undefined => {
  return useAtomValue(currentPageYjsDataAtom);
};

/**
 * Hook to get loading state of current page Yjs data
 */
export const useCurrentPageYjsDataLoading = (): boolean => {
  return useAtomValue(currentPageYjsDataLoadingAtom);
};

/**
 * Hook to get error state of current page Yjs data
 */
export const useCurrentPageYjsDataError = (): Error | undefined => {
  return useAtomValue(currentPageYjsDataErrorAtom);
};

// ============================================================================
// Action Hooks
// ============================================================================

export type CurrentPageYjsDataActions = {
  updateHasYdocsNewerThanLatestRevision: (
    hasYdocsNewerThanLatestRevision: boolean,
  ) => void;
  updateAwarenessStateSize: (awarenessStateSize: number) => void;
  fetchCurrentPageYjsData: () => Promise<CurrentPageYjsData>;
};

/**
 * Actions hook for updating current page Yjs data
 * Provides functions to update the state
 */
export const useCurrentPageYjsDataActions = (): CurrentPageYjsDataActions => {
  const setData = useSetAtom(currentPageYjsDataAtom);
  const setLoading = useSetAtom(currentPageYjsDataLoadingAtom);
  const setError = useSetAtom(currentPageYjsDataErrorAtom);
  const currentPageId = useCurrentPageId();

  const updateHasYdocsNewerThanLatestRevision = useCallback(
    (hasYdocsNewerThanLatestRevision: boolean) => {
      setData((current) =>
        current != null
          ? { ...current, hasYdocsNewerThanLatestRevision }
          : undefined,
      );
    },
    [setData],
  );

  const updateAwarenessStateSize = useCallback(
    (awarenessStateSize: number) => {
      setData((current) =>
        current != null ? { ...current, awarenessStateSize } : undefined,
      );
    },
    [setData],
  );

  const fetchCurrentPageYjsData = useCallback(async () => {
    if (currentPageId == null) {
      throw new Error('Current page ID is not available');
    }

    setLoading(true);
    setError(undefined);

    try {
      const endpoint = `/page/${currentPageId}/yjs-data`;
      const result = await apiv3Get<{ yjsData: CurrentPageYjsData }>(endpoint);
      const yjsData = result.data.yjsData;

      setData(yjsData);
      setLoading(false);

      return yjsData;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error('Failed to fetch Yjs data');
      setError(err);
      setLoading(false);
      throw err;
    }
  }, [setData, setLoading, setError, currentPageId]);

  return {
    updateHasYdocsNewerThanLatestRevision,
    updateAwarenessStateSize,
    fetchCurrentPageYjsData,
  };
};
