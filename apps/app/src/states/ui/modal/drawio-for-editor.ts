import { atom, useAtomValue, useSetAtom } from 'jotai';

type DrawioModalForEditorState = {
  isOpened: boolean;
  editorKey?: string;
};

const drawioModalForEditorAtom = atom<DrawioModalForEditorState>({
  isOpened: false,
  editorKey: undefined,
});

export const useDrawioModalForEditorStatus = () => {
  return useAtomValue(drawioModalForEditorAtom);
};

export const useDrawioModalForEditorActions = () => {
  const setModalState = useSetAtom(drawioModalForEditorAtom);

  return {
    open: (editorKey: string) => {
      setModalState({ isOpened: true, editorKey });
    },
    close: () => {
      setModalState({ isOpened: false, editorKey: undefined });
    },
  };
};
