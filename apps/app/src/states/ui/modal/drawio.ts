import { atom, useAtomValue, useSetAtom } from 'jotai';

// Draw.io modal save handler
type DrawioModalSaveHandler = (drawioMxFile: string) => void;

// Draw.io modal state type
type DrawioModalState = {
  isOpened: boolean;
  drawioMxFile?: string;
  onSave?: DrawioModalSaveHandler;
};

// Atom definition
const drawioModalAtom = atom<DrawioModalState>({
  isOpened: false,
});

// Read-only hook
export const useDrawioModalStatus = () => {
  return useAtomValue(drawioModalAtom);
};

// Actions-only hook
export const useDrawioModalActions = () => {
  const setState = useSetAtom(drawioModalAtom);

  const open = (drawioMxFile: string, onSave?: DrawioModalSaveHandler) => {
    setState({
      isOpened: true,
      drawioMxFile,
      onSave,
    });
  };

  const close = () => {
    setState({ isOpened: false, drawioMxFile: '', onSave: undefined });
  };

  return { open, close };
};
