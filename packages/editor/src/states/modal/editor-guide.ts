import { useMemo } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

export type EditorGuideModalState = {
  isOpened: boolean;
};

const editorGuideModalAtom = atom<EditorGuideModalState>({
  isOpened: false,
});

const openEditorGuideModalAtom = atom(null, (_get, set) => {
  set(editorGuideModalAtom, { isOpened: true });
});

const closeEditorGuideModalAtom = atom(null, (_get, set) => {
  set(editorGuideModalAtom, { isOpened: false });
});

export const useEditorGuideModalStatus = () => {
  return useAtomValue(editorGuideModalAtom);
};

export const useEditorGuideModalActions = () => {
  const open = useSetAtom(openEditorGuideModalAtom);
  const close = useSetAtom(closeEditorGuideModalAtom);
  return useMemo(() => ({ open, close }), [open, close]);
};
