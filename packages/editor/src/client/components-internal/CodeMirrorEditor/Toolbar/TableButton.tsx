import { useCallback } from 'react';

import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';
import { useHandsontableModalForEditor } from '../../../stores/use-handsontable';


type Props = {
  editorKey: string,
}

export const TableButton = (props: Props): JSX.Element => {
  const { editorKey } = props;
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);
  const { open: openTableModal } = useHandsontableModalForEditor();
  const editor = codeMirrorEditor?.view;
  const onClickTableButton = useCallback(() => {
    openTableModal(editor);
  }, [editor, openTableModal]);

  return (
    <button type="button" className="btn btn-toolbar-button" onClick={onClickTableButton}>
      <span className="material-symbols-outlined fs-5">table_chart</span>
    </button>
  );
};
