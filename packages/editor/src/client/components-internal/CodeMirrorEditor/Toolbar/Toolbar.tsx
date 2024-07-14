import { memo } from 'react';

import type { AcceptedUploadFileType } from '@growi/core';

import type { GlobalCodeMirrorEditorKey } from '../../../../consts';

import { AttachmentsDropup } from './AttachmentsDropup';
import { DiagramButton } from './DiagramButton';
import { EmojiButton } from './EmojiButton';
import { TableButton } from './TableButton';
import { TemplateButton } from './TemplateButton';
import { TextFormatTools } from './TextFormatTools';

import styles from './Toolbar.module.scss';

type Props = {
  editorKey: string | GlobalCodeMirrorEditorKey,
  acceptedUploadFileType: AcceptedUploadFileType,
  onUpload?: (files: File[]) => void,
}

export const Toolbar = memo((props: Props): JSX.Element => {

  const { editorKey, acceptedUploadFileType, onUpload } = props;
  return (
    <div className={`d-flex gap-2 py-1 px-2 px-md-3 border-top ${styles['codemirror-editor-toolbar']}`}>
      <AttachmentsDropup editorKey={editorKey} onUpload={onUpload} acceptedUploadFileType={acceptedUploadFileType} />
      <TextFormatTools editorKey={editorKey} />
      <EmojiButton
        editorKey={editorKey}
      />
      <TableButton editorKey={editorKey} />
      <DiagramButton editorKey={editorKey} />
      <TemplateButton editorKey={editorKey} />
    </div>
  );
});
