import { useEffect } from 'react';
import { acceptChunk, getChunks } from '@codemirror/merge';
import type { ViewUpdate } from '@codemirror/view';
import { EditorView } from '@codemirror/view';

import type { UseCodeMirrorEditor } from '..';

export const acceptAllChunks = (view: EditorView): void => {
  // Get all chunks from the editor state
  const chunkData = getChunks(view.state);
  if (chunkData == null || chunkData.chunks.length === 0) {
    return;
  }

  for (const chunk of chunkData.chunks) {
    // Use a position inside the chunk (middle point is safe)
    const pos = chunk.fromB + Math.floor((chunk.endB - chunk.fromB) / 2);
    acceptChunk(view, pos);
  }
};

type OnSelectedArgs = {
  selectedText: string;
  selectedTextIndex: number; // 0-based index in the selected text
  selectedTextFirstLineNumber: number; // 0-based line number
};

type OnSelected = (args: OnSelectedArgs) => void;

const processSelectedText = (
  editorView: EditorView | ViewUpdate,
  onSelected?: OnSelected,
) => {
  const selection = editorView.state.selection.main;
  const selectedText = editorView.state.sliceDoc(selection.from, selection.to);
  const selectedTextIndex = selection.from;
  const selectedTextFirstLineNumber =
    editorView.state.doc.lineAt(selection.from).number - 1; // 0-based line number;
  onSelected?.({
    selectedText,
    selectedTextIndex,
    selectedTextFirstLineNumber,
  });
};

export const useTextSelectionEffect = (
  codeMirrorEditor?: UseCodeMirrorEditor,
  onSelected?: OnSelected,
): void => {
  useEffect(() => {
    if (codeMirrorEditor == null) {
      return;
    }

    // To handle cases where text is already selected in the editor at the time of first effect firing
    if (codeMirrorEditor.view != null) {
      processSelectedText(codeMirrorEditor.view, onSelected);
    }

    const extension = EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        processSelectedText(update, onSelected);
      }
    });

    const cleanup = codeMirrorEditor?.appendExtensions([extension]);

    return () => {
      cleanup?.();
    };
  }, [codeMirrorEditor, onSelected]);
};
