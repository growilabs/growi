// Ref: https://github.com/vadimdemedes/thememirror/blob/94a6475a9113ec03d880fcb817aadcc5a16e82e4/source/themes/ayu-light.ts

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { createTheme } from '@uiw/codemirror-themes';

const foreground = '#5c6166';
const selection = '#036dd626';

// Author: Konstantin Pschera
const ayuTheme = createTheme({
  theme: 'light',
  settings: {
    background: '#fcfcfc',
    foreground,
    caret: '#ffaa33',
    selection,
    gutterBackground: '#fcfcfc',
    gutterForeground: '#8a919966',
    lineHighlight: '#8a91991a',
  },
  styles: [
    {
      tag: t.comment,
      color: '#787b8099',
    },
    {
      tag: t.string,
      color: '#86b300',
    },
    {
      tag: t.regexp,
      color: '#4cbf99',
    },
    {
      tag: [t.number, t.bool, t.null],
      color: '#ffaa33',
    },
    {
      tag: t.variableName,
      color: '#5c6166',
    },
    {
      tag: [t.definitionKeyword, t.modifier],
      color: '#fa8d3e',
    },
    {
      tag: [t.keyword, t.special(t.brace)],
      color: '#fa8d3e',
    },
    {
      tag: t.operator,
      color: '#ed9366',
    },
    {
      tag: t.separator,
      color: '#5c6166b3',
    },
    {
      tag: t.punctuation,
      color: '#5c6166',
    },
    {
      tag: [t.definition(t.propertyName), t.function(t.variableName)],
      color: '#f2ae49',
    },
    {
      tag: [t.className, t.definition(t.typeName)],
      color: '#22a4e6',
    },
    {
      tag: [t.tagName, t.typeName, t.self, t.labelName],
      color: '#55b4d4',
    },
    {
      tag: t.angleBracket,
      color: '#55b4d480',
    },
    {
      tag: t.attributeName,
      color: '#f2ae49',
    },
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

export const ayu: Extension = [ayuTheme, completionTheme];
