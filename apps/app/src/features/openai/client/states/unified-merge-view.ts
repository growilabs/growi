import { useCallback } from 'react';

import { atom, useAtomValue, useSetAtom } from 'jotai';

// Type definitions
export type UnifiedMergeViewActions = {
  enable: () => void;
  disable: () => void;
};

// Atom definition
const isEnableUnifiedMergeViewAtom = atom<boolean>(false);

/**
 * Hook to get the current unified merge view state
 */
export const useIsEnableUnifiedMergeView = (): boolean => {
  return useAtomValue(isEnableUnifiedMergeViewAtom);
};

/**
 * Hook to get actions for unified merge view state
 */
export const useUnifiedMergeViewActions = (): UnifiedMergeViewActions => {
  const setIsEnabled = useSetAtom(isEnableUnifiedMergeViewAtom);

  const enable = useCallback(() => {
    setIsEnabled(true);
  }, [setIsEnabled]);

  const disable = useCallback(() => {
    setIsEnabled(false);
  }, [setIsEnabled]);

  return { enable, disable };
};
