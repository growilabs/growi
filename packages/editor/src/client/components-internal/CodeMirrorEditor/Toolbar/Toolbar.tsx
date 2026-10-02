import { type JSX, memo, useCallback, useRef } from 'react';
import type { AcceptedUploadFileType } from '@growi/core';
import SimpleBar from 'simplebar-react';

import type { GlobalCodeMirrorEditorKey } from '../../../../consts/index.js';
import { AttachmentsDropup } from './AttachmentsDropup.js';
import { DiagramButton } from './DiagramButton.js';
import { EditorGuideButton } from './EditorGuideButton.js';
import { EmojiButton } from './EmojiButton.js';
import { TableButton } from './TableButton.js';
import { TemplateButton } from './TemplateButton.js';
import { TextFormatTools } from './TextFormatTools.js';

import styles from './Toolbar.module.scss';

type Props = {
  editorKey: string | GlobalCodeMirrorEditorKey;
  acceptedUploadFileType: AcceptedUploadFileType;
  onUpload?: (files: File[]) => void;
};

export const Toolbar = memo((props: Props): JSX.Element => {
  const { editorKey, acceptedUploadFileType, onUpload } = props;
  const simpleBarRef = useRef<SimpleBar>(null);

  const onTextFormatToolsCollapseChange = useCallback(() => {
    if (simpleBarRef.current) {
      simpleBarRef.current.recalculate();
    }
  }, []);

  return (
    <>
      <div
        className={`d-flex gap-2 py-1 px-2 px-md-3 border-top ${styles['codemirror-editor-toolbar']} align-items-center`}
      >
        <AttachmentsDropup
          editorKey={editorKey}
          onUpload={onUpload}
          acceptedUploadFileType={acceptedUploadFileType}
        />
        <div className="flex-grow-1">
          <SimpleBar
            ref={simpleBarRef}
            autoHide
            style={{ overflowY: 'hidden' }}
          >
            <div className="d-flex gap-2">
              <TextFormatTools
                editorKey={editorKey}
                onTextFormatToolsCollapseChange={
                  onTextFormatToolsCollapseChange
                }
              />
              <EmojiButton editorKey={editorKey} />
              <TableButton editorKey={editorKey} />
              <DiagramButton editorKey={editorKey} />
              <TemplateButton editorKey={editorKey} />
              <EditorGuideButton />
            </div>
          </SimpleBar>
        </div>
      </div>
    </>
  );
});
