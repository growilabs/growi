import { useEffect, useState } from 'react';
import type { ViewUpdate } from '@codemirror/view';
import { EditorView } from 'codemirror';

import type { UseCodeMirrorEditor } from '../../services';
import { isInTable } from './insert-new-row-to-table-markdown';

const markdownTableActivatedClass = 'markdown-table-activated';

export const useShowTableIcon = (
  codeMirrorEditor?: UseCodeMirrorEditor,
): void => {
  const [editorClass, setEditorClass] = useState('');

  const editor = codeMirrorEditor?.view;

  useEffect(() => {
    const handleFocusChanged = () => {
      if (editor == null) {
        return;
      }
      if (isInTable(editor)) {
        setEditorClass(markdownTableActivatedClass);
      } else {
        setEditorClass('');
      }
    };

    const cleanupFunction = codeMirrorEditor?.appendExtensions(
      EditorView.updateListener.of((v: ViewUpdate) => {
        if (v.transactions.some((tr) => tr.selection || tr.docChanged)) {
          handleFocusChanged();
        }
      }),
    );

    return cleanupFunction;
  }, [codeMirrorEditor, editor]);

  useEffect(() => {
    const cleanupFunction = codeMirrorEditor?.appendExtensions(
      EditorView.editorAttributes.of({ class: editorClass }),
    );

    return cleanupFunction;
  }, [codeMirrorEditor, editorClass]);
};
