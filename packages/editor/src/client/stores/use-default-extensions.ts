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

// Static extensions that do not depend on the current language. The unified
// autocompletion (which resolves slash-command labels via `t`) is composed in at
// registration time; see `createEditorCompletionExtension`.
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
];

/**
 * Build the single unified completion extension that serves BOTH the slash-command
 * source (`/`) and the emoji source (`:`) from one `autocompletion()` instance
 * (Req 6.2). Slash-command labels are resolved once via `resolveSlashCommands(t)`,
 * and the emoji glyph renderer is preserved unchanged via `emojiRenderOption`.
 *
 * Pure function of `t`: no `/` keybinding is registered — the slash menu fires
 * purely from typed input through the completion source (Req 6.4).
 */
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

  // MVP simplification (design §use-default-extensions): resolve labels once at the
  // initial mount language. `t` is stable within a mount under the i18n provider,
  // so memoizing on `[t]` keeps the extension set referentially stable and prevents
  // per-render re-registration.
  const completionExtension = useMemo(
    () => createEditorCompletionExtension(t),
    [t],
  );

  const view = codeMirrorEditor?.view;
  const appendExtensions = codeMirrorEditor?.appendExtensions;

  useEffect(() => {
    if (view == null || appendExtensions == null) return;

    // Register once when the view becomes available. `appendExtensions` creates a
    // fresh Compartment per call, so we MUST reconfigure it back to [] on cleanup;
    // otherwise a language-driven re-register would stack duplicate compartments.
    //
    // The whole set MUST be passed as a SINGLE element (see buildDefaultExtensionsArg):
    // a flat multi-element array throws "Duplicate use of compartment in extensions".
    const cleanup = appendExtensions(
      buildDefaultExtensionsArg(completionExtension),
    );
    return cleanup;
  }, [view, appendExtensions, completionExtension]);
};
