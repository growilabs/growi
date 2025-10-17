import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { type JSX, memo, useEffect } from 'react';

import type { GlobalCodeMirrorEditorKey } from '../../consts';
import {
  CodeMirrorEditor,
  type CodeMirrorEditorProps,
} from '../components-internal/CodeMirrorEditor';
import { useCodeMirrorEditorIsolated } from '../stores/codemirror-editor';

const additionalExtensions: Extension[] = [];

type Props = CodeMirrorEditorProps & {
  editorKey: string | GlobalCodeMirrorEditorKey;
};

export const CodeMirrorEditorComment = memo((props: Props): JSX.Element => {
  const { editorKey, onSave, ...rest } = props;

  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);

  // setup additional extensions
  useEffect(() => {
    return codeMirrorEditor?.appendExtensions?.(additionalExtensions);
  }, [codeMirrorEditor]);

  // set handler to comment with ctrl/cmd + Enter key
  useEffect(() => {
    if (onSave == null) {
      return;
    }

    const keymapExtension = keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => {
          const doc = codeMirrorEditor?.getDoc();
          if (doc != null) {
            onSave();
          }
          return true;
        },
      },
    ]);

    const cleanupFunction =
      codeMirrorEditor?.appendExtensions?.(keymapExtension);

    return cleanupFunction;
  }, [codeMirrorEditor, onSave]);

  return <CodeMirrorEditor editorKey={editorKey} onSave={onSave} {...rest} />;
});
