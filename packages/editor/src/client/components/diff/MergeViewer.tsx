import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { basicSetup, EditorView } from 'codemirror';
import { memo, useEffect, useRef } from 'react';

type Props = {
  leftBody: string;
  rightBody: string;
};

const MergeViewerExtensions: Extension = [
  basicSetup,
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
];

export const MergeViewer = memo(({ leftBody, rightBody }: Props) => {
  const mergeViewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mergeViewRef.current != null) {
      const view = new MergeView({
        a: {
          doc: leftBody,
          extensions: MergeViewerExtensions,
        },
        b: {
          doc: rightBody,
          extensions: MergeViewerExtensions,
        },
        parent: mergeViewRef.current,
      });

      return () => view.destroy();
    }
  });

  return <div ref={mergeViewRef} />;
});
