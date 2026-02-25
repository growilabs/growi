import { MarkdownTable } from '@growi/editor';
import { atom, useAtom, useSetAtom } from 'jotai';

// Handler type definitions
type HandsontableModalSaveHandler = (table: MarkdownTable) => void;

// Handsontable modal state type
type HandsontableModalState = {
  isOpened: boolean;
  table?: MarkdownTable;
  autoFormatMarkdownTable?: boolean;
  onSave?: HandsontableModalSaveHandler;
};

// Default markdown table creation function
const defaultMarkdownTable = () => {
  return new MarkdownTable(
    [
      ['col1', 'col2', 'col3'],
      ['', '', ''],
      ['', '', ''],
    ],
    {
      align: ['', '', ''],
    },
  );
};

// Atom definition
const handsontableModalAtom = atom<HandsontableModalState>({
  isOpened: false,
});

// Read-only hook
export const useHandsontableModalStatus = () => {
  const [state] = useAtom(handsontableModalAtom);
  return state;
};

// Actions-only hook
export const useHandsontableModalActions = () => {
  const setState = useSetAtom(handsontableModalAtom);

  const open = (
    table: MarkdownTable,
    autoFormatMarkdownTable?: boolean,
    onSave?: HandsontableModalSaveHandler,
  ) => {
    setState({
      isOpened: true,
      table,
      autoFormatMarkdownTable,
      onSave,
    });
  };

  const close = () => {
    setState({
      isOpened: false,
      table: defaultMarkdownTable(),
      autoFormatMarkdownTable: false,
      onSave: undefined,
    });
  };

  return { open, close };
};
