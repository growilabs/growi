// Ref: https://github.com/uiwjs/react-codemirror/blob/bf3b862923d0cb04ccf4bb9da0791bdc7fd6d29b/themes/sublime/src/index.ts

import { tags as t } from '@lezer/highlight';
import { createTheme } from '@uiw/codemirror-themes';

export const originalDark = createTheme({
  theme: 'dark',
  settings: {
    background: '#323132',
    foreground: '#EFEEED',
    caret: '#A2A9B5',
    selection: '#4C5964',
    selectionMatch: '#3A546E',
    gutterBackground: '#393939',
    gutterForeground: '#6E6D6C',
    lineHighlight: '#00000030',
  },
  styles: [
    { tag: [t.meta, t.comment], color: '#A2A9B5' },
    { tag: [t.attributeName, t.keyword, t.operator], color: '#9B7F94' },
    { tag: t.function(t.variableName), color: '#5AB0B0' },
    { tag: [t.string, t.attributeValue], color: '#7D9B7B' },
    // { tag: t.moduleKeyword, color: 'red' },
    { tag: [t.tagName, t.modifier], color: '#BA6666' },
    { tag: [t.url, t.escape, t.regexp, t.link], color: '#8FA7C7' },
    {
      tag: [
        t.number,
        t.definition(t.tagName),
        t.className,
        t.definition(t.variableName),
      ],
      color: '#fbac52',
    },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#BA6666' },
    { tag: t.variableName, color: '#539ac4' },
    { tag: [t.propertyName, t.typeName], color: '#629ccd' },
    { tag: t.propertyName, color: '#36b7b5' },
  ],
});
