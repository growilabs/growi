import { autocompletion } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  deleteCharBackward,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { type Extension, Prec } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import type { UseCodeMirrorEditor } from '../services/index.js';
import { emojiAutocompletionSettings } from '../services-internal/index.js';

// set new markdownKeymap instead of default one
// https://github.com/codemirror/lang-markdown/blob/main/src/index.ts#L17
const markdownKeymap: KeyBinding[] = [
  { key: 'Backspace', run: deleteCharBackward },
];

const markdownHighlighting = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-header-1 cm-header' },
  { tag: tags.heading2, class: 'cm-header-2 cm-header' },
  { tag: tags.heading3, class: 'cm-header-3 cm-header' },
  { tag: tags.heading4, class: 'cm-header-4 cm-header' },
  { tag: tags.heading5, class: 'cm-header-5 cm-header' },
  { tag: tags.heading6, class: 'cm-header-6 cm-header' },
]);

// The defaults MINUS feature-specific extensions (emoji) — keeps the shared facility.
// Exported so a regression test can prove mention works on this base without emoji.
export const baseExtensions: Extension[] = [
  EditorView.lineWrapping,
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    addKeymap: false,
  }),
  keymap.of(markdownKeymap),
  keymap.of([indentWithTab]),
  Prec.lowest(keymap.of(defaultKeymap)),
  syntaxHighlighting(markdownHighlighting),
  Prec.lowest(syntaxHighlighting(defaultHighlightStyle)),
  // Shared facility, not owned by any feature. Emoji also adds addToOptions via its own
  // autocompletion() call; CodeMirror dedups the core and merges the configs.
  autocompletion({ icons: false }),
];

const defaultExtensions: Extension[] = [
  ...baseExtensions,
  emojiAutocompletionSettings,
];

export const useDefaultExtensions = (
  codeMirrorEditor?: UseCodeMirrorEditor,
): void => {
  codeMirrorEditor?.appendExtensions([defaultExtensions]);
};
