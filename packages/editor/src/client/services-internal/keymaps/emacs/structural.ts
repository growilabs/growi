import type { EditorView } from '@codemirror/view';

import { insertLinePrefix, toggleMarkdownSymbol } from '../../markdown-utils';

/**
 * Register Emacs markdown-mode structural editing commands and keybindings.
 * Covers headings, blockquote, link, horizontal rule, list items, and fenced code blocks.
 */
export const registerStructuralBindings = (
  EmacsHandler: typeof import('@replit/codemirror-emacs').EmacsHandler,
): void => {
  EmacsHandler.addCommands({
    markdownBlockquote(handler: { view: EditorView }) {
      insertLinePrefix(handler.view, '>');
    },
    markdownLink(handler: { view: EditorView }) {
      toggleMarkdownSymbol(handler.view, '[', ']()');
    },
    markdownHorizontalRule(handler: { view: EditorView }) {
      const { view } = handler;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const insert = line.text.trim() === '' ? '---' : '\n---\n';
      view.dispatch({
        changes: { from: line.from, to: line.to, insert },
        selection: { anchor: line.from + insert.length },
      });
    },
    markdownHeadingDwim(handler: { view: EditorView }) {
      const { view } = handler;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const match = line.text.match(/^(#{1,6})\s/);
      const currentLevel = match ? match[1].length : 0;
      const nextLevel = currentLevel >= 6 ? 1 : currentLevel + 1;
      const prefix = '#'.repeat(nextLevel);
      const content = line.text.replace(/^#{1,6}\s*/, '');
      view.dispatch({
        changes: {
          from: line.from,
          to: line.to,
          insert: `${prefix} ${content}`,
        },
        selection: { anchor: line.from + prefix.length + 1 + content.length },
      });
    },
    markdownHeading1(handler: { view: EditorView }) {
      insertLinePrefix(handler.view, '#', true);
    },
    markdownHeading2(handler: { view: EditorView }) {
      insertLinePrefix(handler.view, '##', true);
    },
    markdownHeading3(handler: { view: EditorView }) {
      insertLinePrefix(handler.view, '###', true);
    },
    markdownHeading4(handler: { view: EditorView }) {
      insertLinePrefix(handler.view, '####', true);
    },
    markdownHeading5(handler: { view: EditorView }) {
      insertLinePrefix(handler.view, '#####', true);
    },
    markdownHeading6(handler: { view: EditorView }) {
      insertLinePrefix(handler.view, '######', true);
    },
    markdownNewListItem(handler: { view: EditorView }) {
      const { view } = handler;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const bulletMatch = line.text.match(/^(\s*)([-*+])\s/);
      const numberedMatch = line.text.match(/^(\s*)(\d+)\.\s/);

      let insert: string;
      if (bulletMatch) {
        insert = `\n${bulletMatch[1]}${bulletMatch[2]} `;
      } else if (numberedMatch) {
        const nextNum = Number.parseInt(numberedMatch[2], 10) + 1;
        insert = `\n${numberedMatch[1]}${nextNum}. `;
      } else {
        insert = '\n- ';
      }

      view.dispatch({
        changes: { from: line.to, insert },
        selection: { anchor: line.to + insert.length },
      });
    },
    markdownFencedCodeBlock(handler: { view: EditorView }) {
      const { view } = handler;
      const { from, to } = view.state.selection.main;
      const selectedText = view.state.sliceDoc(from, to);
      const insert = `\`\`\`\n${selectedText}\n\`\`\``;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + 3 },
      });
    },
  });

  EmacsHandler.bindKey('C-c C-s q', 'markdownBlockquote');
  EmacsHandler.bindKey('C-c C-l', 'markdownLink');
  EmacsHandler.bindKey('C-c C-s -', 'markdownHorizontalRule');
  EmacsHandler.bindKey('C-c C-s h', 'markdownHeadingDwim');
  EmacsHandler.bindKey('C-c C-s 1', 'markdownHeading1');
  EmacsHandler.bindKey('C-c C-s 2', 'markdownHeading2');
  EmacsHandler.bindKey('C-c C-s 3', 'markdownHeading3');
  EmacsHandler.bindKey('C-c C-s 4', 'markdownHeading4');
  EmacsHandler.bindKey('C-c C-s 5', 'markdownHeading5');
  EmacsHandler.bindKey('C-c C-s 6', 'markdownHeading6');
  EmacsHandler.bindKey('C-c C-j', 'markdownNewListItem');
  EmacsHandler.bindKey('C-c C-s S-c', 'markdownFencedCodeBlock');
};
