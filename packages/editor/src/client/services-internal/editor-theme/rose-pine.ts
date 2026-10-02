// Ref: https://github.com/vadimdemedes/thememirror/blob/94a6475a9113ec03d880fcb817aadcc5a16e82e4/source/themes/rose-pine-dawn.ts

import { tags as t } from '@lezer/highlight';
import { createTheme } from '@uiw/codemirror-themes';

// Author: Rosé Pine
export const rosePine = createTheme({
  theme: 'light',
  settings: {
    background: '#faf4ed',
    foreground: '#575279',
    caret: '#575279',
    selection: '#6e6a8614',
    gutterBackground: '#faf4ed',
    gutterForeground: '#57527970',
    lineHighlight: '#6e6a860d',
  },
  styles: [
    {
      tag: t.comment,
      color: '#9893a5',
    },
    {
      tag: [t.bool, t.null],
      color: '#286983',
    },
    {
      tag: t.number,
      color: '#d7827e',
    },
    {
      tag: t.className,
      color: '#d7827e',
    },
    {
      tag: [t.angleBracket, t.tagName, t.typeName],
      color: '#56949f',
    },
    {
      tag: t.attributeName,
      color: '#907aa9',
    },
    {
      tag: t.punctuation,
      color: '#797593',
    },
    {
      tag: [t.keyword, t.modifier],
      color: '#286983',
    },
    {
      tag: [t.string, t.regexp],
      color: '#ea9d34',
    },
    {
      tag: t.variableName,
      color: '#d7827e',
    },
  ],
});
