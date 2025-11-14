import type { EditorTheme, KeyMapMode, PasteMode } from '../../../consts';
import { InitEditorValueRow } from './controller/InitEditorValueRow';
import { KeymapControl } from './controller/KeymapControl';
import { PasteModeControl } from './controller/PasteModeControl';
import { SetCaretLineRow } from './controller/SetCaretLineRow';
import { ThemeControl } from './controller/ThemeControl';
import { UnifiedMergeViewControl } from './controller/UnifiedMergeViewControl';

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
