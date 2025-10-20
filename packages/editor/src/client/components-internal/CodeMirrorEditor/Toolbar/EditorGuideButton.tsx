import { type JSX, useCallback } from 'react';

import { useDrawioModalForEditor } from '../../../stores/use-drawio';

type Props = {
  editorKey: string;
};

export const EditorGuideButton = (props: Props): JSX.Element => {
  const { editorKey } = props;
  const { open: openDrawioModal } = useDrawioModalForEditor();
  const onClickEditorGuideButton = useCallback(() => {
    openDrawioModal(editorKey);
  }, [editorKey, openDrawioModal]);
  return (
    <button
      type="button"
      className="btn btn-toolbar-button"
      onClick={onClickEditorGuideButton}
    >
      <span className="growi-custom-icons fs-6">editor_guide</span>
    </button>
  );
};
