import { type JSX, useCallback, useId } from 'react';
import { UncontrolledTooltip } from 'reactstrap';

import { useHandsontableModalForEditorActions } from '../../../../states/modal/handsontable';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

type Props = {
  editorKey: string;
};

export const TableButton = (props: Props): JSX.Element => {
  const { editorKey } = props;

  const id = useId();

  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);
  const { open: openTableModal } = useHandsontableModalForEditorActions();
  const editor = codeMirrorEditor?.view;
  const onClickTableButton = useCallback(() => {
    openTableModal(editor);
  }, [editor, openTableModal]);

  return (
    <>
      <button
        id={id}
        type="button"
        className="btn btn-toolbar-button"
        onClick={onClickTableButton}
      >
        <span className="material-symbols-outlined fs-5">table</span>
      </button>
      <UncontrolledTooltip placement="top" target={CSS.escape(id)}>
        Table
      </UncontrolledTooltip>
    </>
  );
};
