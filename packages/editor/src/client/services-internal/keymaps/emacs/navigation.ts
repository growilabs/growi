import type { EditorView } from '@codemirror/view';

const HEADING_RE = /^(#{1,6})\s/;

const findHeading = (
  view: EditorView,
  from: number,
  direction: 'forward' | 'backward',
  levelFilter?: number,
): number | null => {
  const doc = view.state.doc;
  const startLine = doc.lineAt(from).number;

  if (direction === 'forward') {
    for (let i = startLine + 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const match = line.text.match(HEADING_RE);
      if (match && (levelFilter == null || match[1].length === levelFilter)) {
        return line.from;
      }
    }
  } else {
    for (let i = startLine - 1; i >= 1; i--) {
      const line = doc.line(i);
      const match = line.text.match(HEADING_RE);
      if (match && (levelFilter == null || match[1].length === levelFilter)) {
        return line.from;
      }
    }
  }
  return null;
};

const getCurrentHeadingLevel = (view: EditorView): number | null => {
  const doc = view.state.doc;
  const curLine = doc.lineAt(view.state.selection.main.head).number;

  for (let i = curLine; i >= 1; i--) {
    const line = doc.line(i);
    const match = line.text.match(HEADING_RE);
    if (match) return match[1].length;
  }
  return null;
};

/**
 * Register Emacs markdown-mode navigation and extended editing commands.
 */
export const registerNavigationBindings = (
  EmacsHandler: typeof import('@replit/codemirror-emacs').EmacsHandler,
): void => {
  EmacsHandler.addCommands({
    markdownNextHeading(handler: { view: EditorView }) {
      const pos = findHeading(
        handler.view,
        handler.view.state.selection.main.head,
        'forward',
      );
      if (pos != null) {
        handler.view.dispatch({ selection: { anchor: pos } });
      }
    },
    markdownPrevHeading(handler: { view: EditorView }) {
      const pos = findHeading(
        handler.view,
        handler.view.state.selection.main.head,
        'backward',
      );
      if (pos != null) {
        handler.view.dispatch({ selection: { anchor: pos } });
      }
    },
    markdownNextSiblingHeading(handler: { view: EditorView }) {
      const level = getCurrentHeadingLevel(handler.view);
      if (level == null) return;
      const pos = findHeading(
        handler.view,
        handler.view.state.selection.main.head,
        'forward',
        level,
      );
      if (pos != null) {
        handler.view.dispatch({ selection: { anchor: pos } });
      }
    },
    markdownPrevSiblingHeading(handler: { view: EditorView }) {
      const level = getCurrentHeadingLevel(handler.view);
      if (level == null) return;
      const pos = findHeading(
        handler.view,
        handler.view.state.selection.main.head,
        'backward',
        level,
      );
      if (pos != null) {
        handler.view.dispatch({ selection: { anchor: pos } });
      }
    },
    markdownUpHeading(handler: { view: EditorView }) {
      const level = getCurrentHeadingLevel(handler.view);
      if (level == null || level <= 1) return;
      const parentLevel = level - 1;
      const pos = findHeading(
        handler.view,
        handler.view.state.selection.main.head,
        'backward',
        parentLevel,
      );
      if (pos != null) {
        handler.view.dispatch({ selection: { anchor: pos } });
      }
    },
    markdownPromote(handler: { view: EditorView }) {
      const { view } = handler;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const headingMatch = line.text.match(HEADING_RE);
      if (headingMatch && headingMatch[1].length > 1) {
        const newPrefix = '#'.repeat(headingMatch[1].length - 1);
        view.dispatch({
          changes: {
            from: line.from,
            to: line.from + headingMatch[1].length,
            insert: newPrefix,
          },
        });
        return;
      }
      // List outdent
      const listMatch = line.text.match(/^(\s{2,})([-*+]|\d+\.)\s/);
      if (listMatch) {
        const newIndent = listMatch[1].slice(2);
        view.dispatch({
          changes: {
            from: line.from,
            to: line.from + listMatch[1].length,
            insert: newIndent,
          },
        });
      }
    },
    markdownDemote(handler: { view: EditorView }) {
      const { view } = handler;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const headingMatch = line.text.match(HEADING_RE);
      if (headingMatch && headingMatch[1].length < 6) {
        const newPrefix = '#'.repeat(headingMatch[1].length + 1);
        view.dispatch({
          changes: {
            from: line.from,
            to: line.from + headingMatch[1].length,
            insert: newPrefix,
          },
        });
        return;
      }
      // List indent
      const listMatch = line.text.match(/^(\s*)([-*+]|\d+\.)\s/);
      if (listMatch) {
        view.dispatch({
          changes: { from: line.from, insert: '  ' },
        });
      }
    },
    markdownKill(handler: { view: EditorView }) {
      const { view } = handler;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const text = line.text;

      // Copy to clipboard
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
      }

      // Delete the line (including newline if not last line)
      const from = line.from;
      const to =
        line.number < view.state.doc.lines
          ? line.to + 1
          : line.from > 0
            ? line.from - 1
            : line.to;
      view.dispatch({
        changes: { from, to, insert: '' },
      });
    },
    markdownImage(handler: { view: EditorView }) {
      toggleMarkdownImageSymbol(handler.view);
    },
    markdownTable(handler: { view: EditorView }) {
      const { view } = handler;
      const pos = view.state.selection.main.head;
      const template =
        '| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |';
      view.dispatch({
        changes: { from: pos, insert: template },
        selection: { anchor: pos + 2 },
      });
    },
    markdownFootnote(handler: { view: EditorView }) {
      const { view } = handler;
      const pos = view.state.selection.main.head;
      const doc = view.state.doc;

      // Find next available footnote number
      let maxNum = 0;
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const matches = line.text.matchAll(/\[\^(\d+)\]/g);
        for (const m of matches) {
          const num = Number.parseInt(m[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
      const nextNum = maxNum + 1;

      // Insert marker at cursor and definition at end of document
      const marker = `[^${nextNum}]`;
      const definition = `\n[^${nextNum}]: `;
      view.dispatch({
        changes: [
          { from: pos, insert: marker },
          { from: doc.length, insert: definition },
        ],
        selection: { anchor: pos + marker.length },
      });
    },
  });

  const toggleMarkdownImageSymbol = (view: EditorView): void => {
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);

    const insert = `![${selectedText}]()`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + 2 + selectedText.length + 2 },
    });
  };

  EmacsHandler.bindKey('C-c C--', 'markdownPromote');
  EmacsHandler.bindKey('C-c C-=', 'markdownDemote');
  EmacsHandler.bindKey('C-c C-n', 'markdownNextHeading');
  EmacsHandler.bindKey('C-c C-p', 'markdownPrevHeading');
  EmacsHandler.bindKey('C-c C-f', 'markdownNextSiblingHeading');
  EmacsHandler.bindKey('C-c C-b', 'markdownPrevSiblingHeading');
  EmacsHandler.bindKey('C-c C-u', 'markdownUpHeading');
  EmacsHandler.bindKey('C-c C-k', 'markdownKill');
  EmacsHandler.bindKey('C-c C-i', 'markdownImage');
  EmacsHandler.bindKey('C-c C-s t', 'markdownTable');
  EmacsHandler.bindKey('C-c C-s f', 'markdownFootnote');
};
