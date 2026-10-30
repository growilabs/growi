import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

type OnSearch = (keyword: string) => void;
export type OpenSearchModalOptions = { isSearchHistoryEnabled?: boolean };
type OpenSearchModal = (
  keywordOnInit?: string,
  onSearchOverride?: OnSearch,
  options?: OpenSearchModalOptions,
) => void;

export type SearchModalStatus = {
  isOpened: boolean;
  searchKeyword?: string;
  onSearchOverride?: OnSearch;
  isSearchHistoryEnabled: boolean;
};

export type SearchModalActions = {
  open: OpenSearchModal;
  close: () => void;
};

// Atom definition
const searchModalAtom = atom<SearchModalStatus>({
  isOpened: false,
  searchKeyword: undefined,
  onSearchOverride: undefined,
  isSearchHistoryEnabled: true,
});

// Read-only hook (useAtomValue)
export const useSearchModalStatus = (): SearchModalStatus => {
  return useAtomValue(searchModalAtom);
};

// Actions hook (useSetAtom + useCallback)
export const useSearchModalActions = (): SearchModalActions => {
  const setStatus = useSetAtom(searchModalAtom);

  const open = useCallback(
    (
      keywordOnInit?: string,
      onSearchOverride?: OnSearch,
      options?: OpenSearchModalOptions,
    ) => {
      setStatus({
        isOpened: true,
        searchKeyword: keywordOnInit,
        onSearchOverride,
        isSearchHistoryEnabled: options?.isSearchHistoryEnabled ?? true,
      });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({
      isOpened: false,
      searchKeyword: undefined,
      onSearchOverride: undefined,
      isSearchHistoryEnabled: true,
    });
  }, [setStatus]);

  return { open, close };
};
