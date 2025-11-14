import { useMemo } from 'react';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { type UseCodeMirror, useCodeMirror } from '@uiw/react-codemirror';
import deepmerge from 'ts-deepmerge';

import {
  type AppendExtensions,
  useAppendExtensions,
} from './utils/append-extensions';
import { type Focus, useFocus } from './utils/focus';
import type { FoldDrawio } from './utils/fold-drawio';
import { useFoldDrawio } from './utils/fold-drawio';
import type { GetDocString } from './utils/get-doc';
import { type GetDoc, useGetDoc, useGetDocString } from './utils/get-doc';
import { type InitDoc, useInitDoc } from './utils/init-doc';
import {
  type InsertMarkdownElements,
  useInsertMarkdownElements,
} from './utils/insert-markdown-elements';
import { type InsertPrefix, useInsertPrefix } from './utils/insert-prefix';
import { type InsertText, useInsertText } from './utils/insert-text';
import { type ReplaceText, useReplaceText } from './utils/replace-text';
import { type SetCaretLine, useSetCaretLine } from './utils/set-caret-line';

type UseCodeMirrorEditorUtils = {
  initDoc: InitDoc;
  appendExtensions: AppendExtensions;
  getDoc: GetDoc;
  getDocString: GetDocString;
  focus: Focus;
  setCaretLine: SetCaretLine;
  insertText: InsertText;
  replaceText: ReplaceText;
  insertMarkdownElements: InsertMarkdownElements;
  insertPrefix: InsertPrefix;
  foldDrawio: FoldDrawio;
};
export type UseCodeMirrorEditor = {
  state: EditorState | undefined;
  view: EditorView | undefined;
} & UseCodeMirrorEditorUtils;

export const useCodeMirrorEditor = (
  props?: UseCodeMirror,
): UseCodeMirrorEditor => {
  const mergedProps = useMemo(
    () =>
      deepmerge(
        {
          // Reset settings of react-codemirror.
          // Extensions are defined first will be used if they have the same priority.
          // If extensions conflict, disable them here.
          // And add them to defaultExtensions: Extension[] with a lower priority.
          // ref: https://codemirror.net/examples/config/
          // ------- Start -------
          indentWithTab: false,
          basicSetup: {
            defaultKeymap: false,
            dropCursor: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          },
          // ------- End -------
        },
        props ?? {},
      ),
    [props],
  );

  const { state, view } = useCodeMirror(mergedProps);

  const initDoc = useInitDoc(view);
  const appendExtensions = useAppendExtensions(view);
  const getDoc = useGetDoc(view);
  const getDocString = useGetDocString(view);
  const focus = useFocus(view);
  const setCaretLine = useSetCaretLine(view);
  const insertText = useInsertText(view);
  const replaceText = useReplaceText(view);
  const insertMarkdownElements = useInsertMarkdownElements(view);
  const insertPrefix = useInsertPrefix(view);
  const foldDrawio = useFoldDrawio(view);

  return {
    state,
    view,
    initDoc,
    appendExtensions,
    getDoc,
    getDocString,
    focus,
    setCaretLine,
    insertText,
    replaceText,
    insertMarkdownElements,
    insertPrefix,
    foldDrawio,
  };
};
