import { atom, useAtomValue, useSetAtom } from 'jotai';

// State type for descendants page list modal
type DescendantsPageListModalState = {
  isOpened: boolean;
  path?: string;
};

// Atom definition
const descendantsPageListModalAtom = atom<DescendantsPageListModalState>({
  isOpened: false,
});

// Read-only hook
export const useDescendantsPageListModalStatus = () => {
  return useAtomValue(descendantsPageListModalAtom);
};

// Actions-only hook
export const useDescendantsPageListModalActions = () => {
  const setState = useSetAtom(descendantsPageListModalAtom);

  const open = (path: string) => {
    setState({ isOpened: true, path });
  };

  const close = () => {
    setState({ isOpened: false });
  };

  return { open, close };
};
