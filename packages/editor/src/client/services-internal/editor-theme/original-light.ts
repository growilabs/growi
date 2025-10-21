// Ref: https://github.com/uiwjs/react-codemirror/blob/bf3b862923d0cb04ccf4bb9da0791bdc7fd6d29b/themes/github/src/index.ts

import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { createTheme } from '@uiw/codemirror-themes';

export const originalLight: Extension = createTheme({
  theme: 'light',
  settings: {
    background: '#fff',
    foreground: '#24292e',
    selection: '#BBDFFF',
    selectionMatch: '#BBDFFF',
    gutterBackground: '#FAF9F8',
    gutterForeground: '#BCBBBA',
  },
  styles: [
    { tag: [t.standard(t.tagName), t.tagName], color: '#377148' },
    { tag: [t.comment, t.bracket], color: '#6a737d' },
    { tag: [t.className, t.propertyName], color: '#6f42c1' },
    {
      tag: [t.keyword, t.typeName, t.typeOperator, t.typeName],
      color: '#d73a49',
    },
    { tag: [t.name, t.quote], color: '#22863a' },
    { tag: [t.heading], color: '#24292e', fontWeight: 'bold' },
    { tag: [t.emphasis], color: '#24292e', fontStyle: 'italic' },
    { tag: [t.deleted], color: '#b31d28', backgroundColor: 'ffeef0' },
    { tag: [t.string, t.meta, t.regexp], color: '#032F62' },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#e36209' },
    { tag: [t.url, t.escape, t.regexp, t.link], color: '#032f62' },
    { tag: t.link, textDecoration: 'underline' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    {
      tag: [
        t.variableName,
        t.attributeName,
        t.number,
        t.operator,
        t.character,
        t.brace,
        t.processingInstruction,
        t.inserted,
      ],
      color: '#516883',
    },
    { tag: [t.strong], color: '#744763' },
    { tag: t.invalid, color: '#cb2431' },
  ],
});
