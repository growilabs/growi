import { atom, useAtomValue, useSetAtom } from 'jotai';

export type EditorGuideModalState = {
  isOpened: boolean;
};

const editorGuideModalAtom = atom<EditorGuideModalState>({
  isOpened: false,
});

export const useEditorGuideModalStatus = () => {
  return useAtomValue(editorGuideModalAtom);
};

export const useEditorGuideModalActions = () => {
  const setModalState = useSetAtom(editorGuideModalAtom);

  return {
    open: () => {
      setModalState({ isOpened: true });
    },
    close: () => {
      setModalState({ isOpened: false });
    },
  };
};
