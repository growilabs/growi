// Ref: https://github.com/uiwjs/react-codemirror/blob/bf3b862923d0cb04ccf4bb9da0791bdc7fd6d29b/extensions/classname/src/index.ts

import { RangeSetBuilder } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { Decoration, ViewPlugin } from '@codemirror/view';

const stripeDeco = (view: EditorView) => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const cls = line.number.toString();
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          attributes: { 'data-line': cls },
        }),
      );
      pos = line.to + 1;
    }
  }
  return builder.finish();
};

export const setDataLine = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = stripeDeco(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = stripeDeco(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
