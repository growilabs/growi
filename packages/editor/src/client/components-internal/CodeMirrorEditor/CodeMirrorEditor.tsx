import type { DetailedHTMLProps, JSX } from 'react';
import {
  forwardRef, useMemo, useRef, useEffect,
} from 'react';

import { indentUnit } from '@codemirror/language';
import {
  EditorView,
} from '@codemirror/view';
import { AcceptedUploadFileType } from '@growi/core';
import type { ReactCodeMirrorProps } from '@uiw/react-codemirror';

import { PasteMode, type EditorSettings, type GlobalCodeMirrorEditorKey } from '../../../consts';
import {
  useFileDropzone, FileDropzoneOverlay, useShowTableIcon, getStrFromBol, adjustPasteData,
} from '../../services-internal';
import { useCodeMirrorEditorIsolated } from '../../stores/codemirror-editor';
import { useDefaultExtensions } from '../../stores/use-default-extensions';
import { useEditorSettings } from '../../stores/use-editor-settings';

import { Toolbar } from './Toolbar';


import style from './CodeMirrorEditor.module.scss';

const moduleClass = style['codemirror-editor'];


// Fix IME cursor position issue by EditContext
// ref: https://github.com/growilabs/growi/pull/9267
// ref: https://discuss.codemirror.net/t/issue-with-google-japanese-ime-cursor-position-in-v6/8810/3
(EditorView as unknown as { EDIT_CONTEXT: boolean }).EDIT_CONTEXT = false;


const CodeMirrorEditorContainer = forwardRef<HTMLDivElement, DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>>(
  (props, ref) => {
    const { className = '', ...rest } = props;
    return (
      <div className={`${className} flex-expand-vert ${style['codemirror-editor-container']}`} ref={ref} {...rest} />
    );
  },
);

export type CodeMirrorEditorProps = {
  /**
   * Specity the props for the react-codemirror component. **This must be a memolized object.**
   */
  cmProps?: ReactCodeMirrorProps,
  acceptedUploadFileType?: AcceptedUploadFileType,
  indentSize?: number,
  editorSettings?: EditorSettings,
  onSave?: () => void,
  onUpload?: (files: File[]) => void,
  onScroll?: () => void,
}

type Props = CodeMirrorEditorProps & {
  editorKey: string | GlobalCodeMirrorEditorKey,
  className?: string,
  hideToolbar?: boolean,
}

export const CodeMirrorEditor = (props: Props): JSX.Element => {
  const {
    editorKey,
    className,
    hideToolbar,

    cmProps,
    acceptedUploadFileType = AcceptedUploadFileType.NONE,
    indentSize,
    editorSettings,
    onSave,
    onUpload,
    onScroll,
  } = props;

  const containerRef = useRef(null);

  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey, containerRef.current, cmProps);

  useDefaultExtensions(codeMirrorEditor);
  useEditorSettings(codeMirrorEditor, editorSettings, onSave);

  useShowTableIcon(codeMirrorEditor);

  useEffect(() => {
    if (indentSize == null) {
      return;
    }
    const extension = indentUnit.of(' '.repeat(indentSize));

    const cleanupFunction = codeMirrorEditor?.appendExtensions?.(extension);
    return cleanupFunction;

  }, [codeMirrorEditor, indentSize]);

  const pasteMode = editorSettings?.pasteMode;
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault();

      const editor = codeMirrorEditor?.view;

      if (editor == null || event.clipboardData == null) {
        return;
      }

      if (event.clipboardData.types.includes('text/plain')) {
        if (codeMirrorEditor == null) return;

        if (pasteMode == null || pasteMode === PasteMode.both || pasteMode === PasteMode.text) {
          const textData = event.clipboardData.getData('text/plain');

          const strFromBol = getStrFromBol(editor);
          const adjusted = adjustPasteData(strFromBol, textData);

          codeMirrorEditor.replaceText(adjusted);
        }
      }

      if (event.clipboardData.types.includes('Files')) {
        if (onUpload == null) return;

        if (pasteMode == null || pasteMode === PasteMode.both || pasteMode === PasteMode.file) {
          onUpload(Array.from(event.clipboardData.files));
        }
      }
    };

    const extension = EditorView.domEventHandlers({
      paste: handlePaste,
    });

    const cleanupFunction = codeMirrorEditor?.appendExtensions(extension);
    return cleanupFunction;

  }, [codeMirrorEditor, pasteMode, onUpload]);

  useEffect(() => {

    const handleDrop = (event: DragEvent) => {
      // prevents conflicts between codemirror and react-dropzone during file drops.
      event.preventDefault();
    };

    const extension = EditorView.domEventHandlers({
      drop: handleDrop,
    });

    const cleanupFunction = codeMirrorEditor?.appendExtensions(extension);
    return cleanupFunction;

  }, [codeMirrorEditor]);

  useEffect(() => {

    const handleScroll = (event: Event) => {
      event.preventDefault();
      if (onScroll != null) {
        onScroll();
      }
    };

    const extension = EditorView.domEventHandlers({
      scroll: handleScroll,
    });

    const cleanupFunction = codeMirrorEditor?.appendExtensions(extension);
    return cleanupFunction;

  }, [onScroll, codeMirrorEditor]);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
    isUploading,
  } = useFileDropzone({
    acceptedUploadFileType,
    onUpload,
    // ignore mouse and key events
    dropzoneOpts: {
      noClick: true,
      noKeyboard: true,
    },
  });

  const fileUploadState = useMemo(() => {

    if (isUploading) {
      return 'dropzone-uploading';
    }

    switch (acceptedUploadFileType) {
      case AcceptedUploadFileType.NONE:
        return 'dropzone-disabled';

      case AcceptedUploadFileType.IMAGE:
        if (isDragAccept) {
          return 'dropzone-accepted';
        }
        if (isDragReject) {
          return 'dropzone-mismatch-picture';
        }
        break;

      case AcceptedUploadFileType.ALL:
        if (isDragAccept) {
          return 'dropzone-accepted';
        }
        if (isDragReject) {
          return 'dropzone-rejected';
        }
        break;
    }

    return '';
  }, [isUploading, isDragAccept, isDragReject, acceptedUploadFileType]);

  return (
    <div className={`${className} ${moduleClass} flex-expand-vert overflow-y-hidden`}>
      <div {...getRootProps()} className={`dropzone  ${fileUploadState} flex-expand-vert`}>
        <input {...getInputProps()} />
        <FileDropzoneOverlay isEnabled={isDragActive} />
        <CodeMirrorEditorContainer ref={containerRef} />
      </div>
      {!hideToolbar && (
        <Toolbar
          editorKey={editorKey}
          acceptedUploadFileType={acceptedUploadFileType}
          onUpload={onUpload}
        />
      )}
    </div>
  );
};
