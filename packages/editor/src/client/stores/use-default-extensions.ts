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
  emojiAutocompletionSettings,
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
  completionMenuTheme,
];

const defaultExtensions: Extension[] = [
  ...baseExtensions,
  emojiAutocompletionSettings,
];

// Slash commands register their source the same way as emoji/mention — as a
// Markdown language-data autocomplete source — so all three coexist in the shared
// autocompletion() facility (an `override` would replace the language-data sources
// and break mention). Labels are resolved via `t`; no `/` keybinding is added, so
// the slash menu fires from typed input and the global `/` (page search) is
// preserved (Req 6.4).
export const createSlashCommandExtension = (t: TFunction): Extension =>
  markdownLanguage.data.of({
    autocomplete: createSlashCommandSource(resolveSlashCommands(t)),
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
  slashCommandExtension: Extension,
): Extension[] => [[...defaultExtensions, slashCommandExtension]];

export const useDefaultExtensions = (
  codeMirrorEditor?: UseCodeMirrorEditor,
): void => {
  const { t } = useTranslation('translation');

  const slashCommandExtension = useMemo(
    () => createSlashCommandExtension(t),
    [t],
  );

  const view = codeMirrorEditor?.view;
  const appendExtensions = codeMirrorEditor?.appendExtensions;

  useEffect(() => {
    if (view == null || appendExtensions == null) return;

    // Return the cleanup so a re-register (e.g. language change) tears down the
    // previous compartment first, instead of stacking duplicates.
    const cleanup = appendExtensions(
      buildDefaultExtensionsArg(slashCommandExtension),
    );
    return cleanup;
  }, [view, appendExtensions, slashCommandExtension]);
};
