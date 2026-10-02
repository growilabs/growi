import { useAtomValue } from 'jotai';

import { pageErrorAtom, pageLoadingAtom } from './internal-atoms';

/**
 * Hook to access current page loading state
 * Provides consistent loading and error state across the application
 */
export const useCurrentPageLoading = (): {
  isLoading: boolean;
  error: Error | null;
} => {
  const isLoading = useAtomValue(pageLoadingAtom);
  const error = useAtomValue(pageErrorAtom);

  return { isLoading, error };
};
