import { useEffect, useMemo } from 'react';
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
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { UseCodeMirrorEditor } from '../services/index.js';
import {
  createSlashCommandSource,
  emojiCompletionSource,
  emojiRenderOption,
  resolveSlashCommands,
} from '../services-internal/index.js';

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

const completionMenuTheme = EditorView.baseTheme({
  '.cm-tooltip-autocomplete .cm-completionLabel': {
    color: 'var(--bs-gray-800)',
  },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    color: 'var(--bs-gray-600)',
  },
});

const staticExtensions: Extension[] = [
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
  completionMenuTheme,
];

// No `/` keybinding is registered — the slash menu fires from typed input via the
// completion source, so the global `/` (page search) is preserved (Req 6.4).
export const createEditorCompletionExtension = (t: TFunction): Extension =>
  autocompletion({
    override: [
      createSlashCommandSource(resolveSlashCommands(t)),
      emojiCompletionSource,
    ],
    addToOptions: [emojiRenderOption],
    icons: false,
  });

/**
 * Build the argument passed to `appendExtensions` for the whole default set.
 *
 * It MUST be a single-element array whose sole element nests the full extension
 * set: `appendExtensions` wraps every top-level array element with the SAME
 * Compartment, and a Compartment can wrap only one extension — a flat
 * multi-element array throws "Duplicate use of compartment in extensions" at
 * runtime. Keeping the outer array length 1 keeps it one compartment for the set.
 */
export const buildDefaultExtensionsArg = (
  completionExtension: Extension,
): Extension[] => [[...staticExtensions, completionExtension]];

export const useDefaultExtensions = (
  codeMirrorEditor?: UseCodeMirrorEditor,
): void => {
  const { t } = useTranslation('translation');

  const completionExtension = useMemo(
    () => createEditorCompletionExtension(t),
    [t],
  );

  const view = codeMirrorEditor?.view;
  const appendExtensions = codeMirrorEditor?.appendExtensions;

  useEffect(() => {
    if (view == null || appendExtensions == null) return;

    // Return the cleanup so a re-register (e.g. language change) tears down the
    // previous compartment first, instead of stacking duplicates.
    const cleanup = appendExtensions(
      buildDefaultExtensionsArg(completionExtension),
    );
    return cleanup;
  }, [view, appendExtensions, completionExtension]);
};
