import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

type OnSearch = (keyword: string) => void;
type OpenSearchModal = (
  keywordOnInit?: string,
  onSearchOverride?: OnSearch,
) => void;

export type SearchModalStatus = {
  isOpened: boolean;
  searchKeyword?: string;
  onSearchOverride?: OnSearch;
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
});

// Read-only hook (useAtomValue)
export const useSearchModalStatus = (): SearchModalStatus => {
  return useAtomValue(searchModalAtom);
};

// Actions hook (useSetAtom + useCallback)
export const useSearchModalActions = (): SearchModalActions => {
  const setStatus = useSetAtom(searchModalAtom);

  const open = useCallback(
    (keywordOnInit?: string, onSearchOverride?: OnSearch) => {
      setStatus({
        isOpened: true,
        searchKeyword: keywordOnInit,
        onSearchOverride,
      });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({
      isOpened: false,
      searchKeyword: undefined,
      onSearchOverride: undefined,
    });
  }, [setStatus]);

  return { open, close };
};
