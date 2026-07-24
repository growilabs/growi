import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

const MENTION_REGEX = /\B@[\w@.-]+/g;

const mentionMark = Decoration.mark({ class: 'cm-mention-user' });

const mentionTheme = EditorView.baseTheme({
  '.cm-mention-user': {
    color: 'var(--bs-primary)',
    fontWeight: '600',
  },
});

const buildDecorations = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    MENTION_REGEX.lastIndex = 0;
    let match = MENTION_REGEX.exec(text);
    while (match !== null) {
      builder.add(
        from + match.index,
        from + match.index + match[0].length,
        mentionMark,
      );
      match = MENTION_REGEX.exec(text);
    }
  }
  return builder.finish();
};

const mentionDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const mentionDecorationSettings = [
  mentionDecorationPlugin,
  mentionTheme,
];
