import { type JSX, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import { useTemplateModalActions } from '../../../../states/modal/template';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

type Props = {
  editorKey: string;
};

export const TemplateButton = (props: Props): JSX.Element => {
  const { editorKey } = props;

  const id = useId();
  const { t } = useTranslation('commons');

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
        id={id}
        type="button"
        className="btn btn-toolbar-button"
        onClick={onClickTempleteButton}
        data-testid="open-template-button"
      >
        <span className="material-symbols-outlined fs-5">file_copy</span>
      </button>
      <UncontrolledTooltip placement="top" target={CSS.escape(id)}>
        {t('toolbar.template')}
      </UncontrolledTooltip>
    </>
  );
};
