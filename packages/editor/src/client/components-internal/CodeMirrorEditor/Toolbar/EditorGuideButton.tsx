import { type JSX, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import { useEditorGuideModalActions } from '../../../../states/modal/editor-guide';

export const EditorGuideButton = (): JSX.Element => {
  const { open: openEditorGuideModal } = useEditorGuideModalActions();
  const id = useId();
  const { t } = useTranslation('translation');

  const onClickEditorGuideButton = useCallback(() => {
    openEditorGuideModal();
  }, [openEditorGuideModal]);

  return (
    <div className="d-none d-lg-block">
      <button
        id={id}
        type="button"
        className="btn btn-toolbar-button"
        onClick={onClickEditorGuideButton}
      >
        <span className="growi-custom-icons fs-6">editor_guide</span>
      </button>
      <UncontrolledTooltip placement="top" target={CSS.escape(id)}>
        {t('toolbar.editor_guide')}
      </UncontrolledTooltip>
    </div>
  );
};
