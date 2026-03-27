import { type JSX, useCallback, useRef } from 'react';
import { UncontrolledTooltip } from 'reactstrap';

import { useTemplateModalActions } from '../../../../states/modal/template';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

type Props = {
  editorKey: string;
};

export const TemplateButton = (props: Props): JSX.Element => {
  const { editorKey } = props;

  const buttonRef = useRef<HTMLButtonElement>(null);

  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);
  const { open: openTemplateModal } = useTemplateModalActions();

  const onClickTempleteButton = useCallback(() => {
    const editor = codeMirrorEditor?.view;
    if (editor != null) {
      const insertText = (text: string) =>
        editor.dispatch(editor.state.replaceSelection(text));
      const onSubmit = (templateText: string) => insertText(templateText);
      openTemplateModal({ onSubmit });
    }
  }, [codeMirrorEditor?.view, openTemplateModal]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-toolbar-button"
        onClick={onClickTempleteButton}
        data-testid="open-template-button"
      >
        <span className="material-symbols-outlined fs-5">file_copy</span>
      </button>
      <UncontrolledTooltip placement="top" target={buttonRef}>
        Template
      </UncontrolledTooltip>
    </>
  );
};
