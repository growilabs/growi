import type { EditorView } from '@codemirror/view';
import { atom, useAtomValue, useSetAtom } from 'jotai';


type HandsontableModalState = {
  isOpened: boolean;
  editor?: EditorView;
};

const handsontableModalAtom = atom<HandsontableModalState>({
  isOpened: false,
  editor: undefined,
});

export const useHandsontableModalForEditorStatus = () => useAtomValue(handsontableModalAtom);

export const useHandsontableModalForEditorActions = () => {
  const setModalState = useSetAtom(handsontableModalAtom);

  return {
    open: (editor?: EditorView) => {
      setModalState({ isOpened: true, editor });
    },
    close: () => {
      setModalState({ isOpened: false, editor: undefined });
    },
  };
};
