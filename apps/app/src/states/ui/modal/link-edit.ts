import type { Linker } from '@growi/editor/dist/models';
import { atom, useAtomValue, useSetAtom } from 'jotai';

type LinkEditModalState = {
  isOpened: boolean;
  defaultMarkdownLink?: Linker;
  onSave?: (linkText: string) => void;
};

const linkEditModalAtom = atom<LinkEditModalState>({
  isOpened: false,
  defaultMarkdownLink: undefined,
  onSave: undefined,
});

export const useLinkEditModalStatus = () => {
  return useAtomValue(linkEditModalAtom);
};

export const useLinkEditModalActions = () => {
  const setModalState = useSetAtom(linkEditModalAtom);

  return {
    open: (defaultMarkdownLink: Linker, onSave: (linkText: string) => void) => {
      setModalState({ isOpened: true, defaultMarkdownLink, onSave });
    },
    close: () => {
      setModalState({
        isOpened: false,
        defaultMarkdownLink: undefined,
        onSave: undefined,
      });
    },
  };
};
