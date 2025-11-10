import { atom, useAtomValue, useSetAtom } from 'jotai';

type PageBulkExportSelectModalState = {
  isOpened: boolean;
};

const pageBulkExportSelectModalAtom = atom<PageBulkExportSelectModalState>({
  isOpened: false,
});

export const usePageBulkExportSelectModalStatus = () => {
  return useAtomValue(pageBulkExportSelectModalAtom);
};

export const usePageBulkExportSelectModalActions = () => {
  const setModalState = useSetAtom(pageBulkExportSelectModalAtom);

  return {
    open: () => {
      setModalState({ isOpened: true });
    },
    close: () => {
      setModalState({ isOpened: false });
    },
  };
};
