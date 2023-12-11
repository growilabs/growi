import { memo } from 'react';

import type { GlobalCodeMirrorEditorKey, AcceptedUploadFileType } from '../../../consts';

import { AttachmentsDropup } from './AttachmentsDropup';
import { DiagramButton } from './DiagramButton';
import { EmojiButton } from './EmojiButton';
import { TableButton } from './TableButton';
import { TemplateButton } from './TemplateButton';
import { TextFormatTools } from './TextFormatTools';

import styles from './Toolbar.module.scss';

type Props = {
  editorKey: string | GlobalCodeMirrorEditorKey,
  onFileOpen: () => void,
  acceptedFileType: AcceptedUploadFileType
}

export const Toolbar = memo((props: Props): JSX.Element => {

  const { editorKey, onFileOpen, acceptedFileType } = props;
  return (
    <div className={`d-flex gap-2 p-2 codemirror-editor-toolbar ${styles['codemirror-editor-toolbar']}`}>
      <AttachmentsDropup onFileOpen={onFileOpen} acceptedFileType={acceptedFileType} />
      <TextFormatTools editorKey={editorKey} />
      <EmojiButton
        editorKey={editorKey}
      />
      <TableButton editorKey={editorKey} />
      <DiagramButton />
      <TemplateButton />
    </div>
  );
});
