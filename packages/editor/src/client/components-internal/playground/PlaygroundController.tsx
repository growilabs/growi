import type { EditorTheme, KeyMapMode, PasteMode } from '../../../consts/index.js';
import { InitEditorValueRow } from './controller/InitEditorValueRow.js';
import { KeymapControl } from './controller/KeymapControl.js';
import { PasteModeControl } from './controller/PasteModeControl.js';
import { SetCaretLineRow } from './controller/SetCaretLineRow.js';
import { ThemeControl } from './controller/ThemeControl.js';
import { UnifiedMergeViewControl } from './controller/UnifiedMergeViewControl.js';

type PlaygroundControllerProps = {
  setEditorTheme: (value: EditorTheme) => void;
  setEditorKeymap: (value: KeyMapMode) => void;
  setEditorPaste: (value: PasteMode) => void;
  setUnifiedMergeView: (value: boolean) => void;
};

export const PlaygroundController = (
  props: PlaygroundControllerProps,
): JSX.Element => {
  return (
    <div className="container">
      <InitEditorValueRow />
      <SetCaretLineRow />
      <UnifiedMergeViewControl
        onChange={(bool) => props.setUnifiedMergeView(bool)}
      />
      <ThemeControl setEditorTheme={props.setEditorTheme} />
      <KeymapControl setEditorKeymap={props.setEditorKeymap} />
      <PasteModeControl setEditorPaste={props.setEditorPaste} />
    </div>
  );
};
