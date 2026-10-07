// Ref: https://github.com/vadimdemedes/thememirror/blob/94a6475a9113ec03d880fcb817aadcc5a16e82e4/source/themes/ayu-light.ts

import { tags as t } from '@lezer/highlight';
import { createTheme } from '@uiw/codemirror-themes';

// Author: Konstantin Pschera
export const ayu = createTheme({
  theme: 'light',
  settings: {
    background: '#fcfcfc',
    foreground: '#5c6166',
    caret: '#ffaa33',
    selection: '#036dd626',
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
