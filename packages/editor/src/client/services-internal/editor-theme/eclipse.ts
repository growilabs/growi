// Ref: https://github.com/uiwjs/react-codemirror/blob/399d127f59a97a64974a65923d477d585d2abee5/themes/eclipse/src/index.ts
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { createTheme } from '@uiw/codemirror-themes';

const foreground = '#000';
const selection = '#d7d4f0';

const eclipseTheme = createTheme({
  theme: 'light',
  settings: {
    background: '#fff',
    foreground,
    // Change color
    caret: '#000',
    selection,
    selectionMatch: '#d7d4f0',
    gutterBackground: '#f7f7f7',
    gutterForeground: '#999',
    lineHighlight: '#006fff1c',
    gutterBorder: 'transparent',
  },
  styles: [
    { tag: [t.comment], color: '#3F7F5F' },
    { tag: [t.documentMeta], color: '#FF1717' },
    { tag: t.keyword, color: '#7F0055', fontWeight: 'bold' },
    { tag: t.atom, color: '#00f' },
    { tag: t.number, color: '#164' },
    { tag: t.propertyName, color: '#164' },
    { tag: [t.variableName, t.definition(t.variableName)], color: '#0000C0' },
    { tag: t.function(t.variableName), color: '#0000C0' },
    { tag: t.string, color: '#2A00FF' },
    { tag: t.operator, color: 'black' },
    { tag: t.tagName, color: '#170' },
    { tag: t.attributeName, color: '#00c' },
    { tag: t.link, color: '#219' },
  ],
});

// createTheme cannot style the completion tooltip, so define the selected item colors here.
// Without this, CodeMirror's default (blue background) is used, which is hard to read with dark text.
const completionTheme = EditorView.theme({
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: selection,
    color: foreground,
  },
});

export const eclipse: Extension = [eclipseTheme, completionTheme];
