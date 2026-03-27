import { type JSX, useCallback, useRef } from 'react';
import { UncontrolledTooltip } from 'reactstrap';

import { useDrawioModalForEditorActions } from '../../../../states/modal/drawio-for-editor';

type Props = {
  editorKey: string;
};

export const DiagramButton = (props: Props): JSX.Element => {
  const { editorKey } = props;
  const { open: openDrawioModal } = useDrawioModalForEditorActions();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const onClickDiagramButton = useCallback(() => {
    openDrawioModal(editorKey);
  }, [editorKey, openDrawioModal]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-toolbar-button"
        onClick={onClickDiagramButton}
      >
        {/* TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015 */}
        <span className="growi-custom-icons fs-6">drawer_io</span>
      </button>
      <UncontrolledTooltip placement="top" target={buttonRef}>
        Diagram
      </UncontrolledTooltip>
    </>
  );
};
