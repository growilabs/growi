import { type JSX, useCallback } from 'react';

import { useEditorGuideModal } from '../../../stores/use-editor-guide-modal';

export const EditorGuideButton = (): JSX.Element => {
  const { open: openEditorGuideModal } = useEditorGuideModal();

  const onClickEditorGuideButton = useCallback(() => {
    openEditorGuideModal();
  }, [openEditorGuideModal]);

  return (
    <button
      type="button"
      className="btn btn-toolbar-button d-none d-lg-block"
      onClick={onClickEditorGuideButton}
    >
      <span className="growi-custom-icons fs-6">editor_guide</span>
    </button>
  );
};
