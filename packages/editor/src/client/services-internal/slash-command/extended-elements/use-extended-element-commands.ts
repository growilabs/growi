import { useMemo, useRef } from 'react';
import type { EditorView } from '@codemirror/view';

import { useDrawioModalForEditorActions } from '../../../../states/modal/drawio-for-editor.js';
import { useHandsontableModalForEditorActions } from '../../../../states/modal/handsontable.js';
import { useLinkEditModalActions } from '../../../../states/modal/link-edit.js';
import {
  getMarkdownLink,
  replaceFocusedMarkdownLinkWithEditor,
} from '../../link-util/markdown-link-util.js';
import type { SlashCommand } from '../slash-command-types.js';
import { ensureBlockLineStart } from './ensure-block-line-start.js';
import { STATIC_EXTENDED_COMMANDS } from './static-commands.js';

/**
 * The modal openers the run commands bind. Derived from the existing trigger hooks
 * so the signatures (e.g. drawio's `open(editorKey)` vs table-builder's
 * `open(view)`) stay in sync with them.
 */
export interface ExtendedElementModalOpeners {
  readonly openDrawio: ReturnType<
    typeof useDrawioModalForEditorActions
  >['open'];
  readonly openLink: ReturnType<typeof useLinkEditModalActions>['open'];
  readonly openTableBuilder: ReturnType<
    typeof useHandsontableModalForEditorActions
  >['open'];
}

/**
 * Build the extended-element command set (pure): side-effect (`run`) commands that
 * open existing modals, plus the static ({@link STATIC_EXTENDED_COMMANDS}) ones. The
 * base composition point concats this after `SLASH_COMMANDS`.
 *
 * `editorKey` is required only by drawio (its opener takes `open(editorKey)`);
 * link/table-builder take the `EditorView` that `run` already receives, and the
 * static commands (plantuml/callout/lsx) are context-free. When `editorKey` is
 * absent (e.g. the diff editor) only drawio is omitted.
 *
 * Extracted from the hook so the gating/ordering/normalization logic is unit-testable
 * without a React renderer.
 */
export const buildExtendedElementCommands = (
  editorKey: string | undefined,
  openers: ExtendedElementModalOpeners,
): readonly SlashCommand[] => {
  const runCommands: SlashCommand[] = [];

  // drawio needs editorKey; skip it when unavailable (lsx is a static inline
  // insert in STATIC_EXTENDED_COMMANDS, not a run command gated by editorKey).
  if (editorKey != null) {
    runCommands.push({
      id: 'drawio',
      labelKey: 'slash_command.drawio.label',
      descriptionKey: 'slash_command.drawio.description',
      keywords: ['diagram', 'draw'],
      disallowedIn: ['list', 'table'], // block element (```drawio fence)
      action: {
        kind: 'run',
        run: (view: EditorView, from: number) => {
          ensureBlockLineStart(view, from);
          openers.openDrawio(editorKey);
        },
      },
    });
  }

  runCommands.push({
    id: 'link',
    labelKey: 'slash_command.link.label',
    descriptionKey: 'slash_command.link.description',
    keywords: ['url', 'href'],
    // inline element: no disallowedIn, no line-start normalization (Req 9.1)
    action: {
      kind: 'run',
      run: (view: EditorView) => {
        openers.openLink(getMarkdownLink(view), (linkText) =>
          replaceFocusedMarkdownLinkWithEditor(view, linkText),
        );
      },
    },
  });

  runCommands.push({
    id: 'tableBuilder',
    labelKey: 'slash_command.tableBuilder.label',
    descriptionKey: 'slash_command.tableBuilder.description',
    keywords: ['table', 'grid', 'builder'],
    disallowedIn: ['list', 'table'], // block element (Markdown table)
    action: {
      kind: 'run',
      run: (view: EditorView, from: number) => {
        ensureBlockLineStart(view, from);
        openers.openTableBuilder(view);
      },
    },
  });

  return [...runCommands, ...STATIC_EXTENDED_COMMANDS];
};

/**
 * React wrapper over {@link buildExtendedElementCommands}: reads the modal openers
 * from their trigger hooks and memoizes the command list on `editorKey`.
 *
 * The openers are fresh functions each render but close over stable jotai setters,
 * so they are held in a ref and excluded from the memo deps — keeping the returned
 * list stable across renders so the slash extension is not re-registered every render.
 */
export const useExtendedElementCommands = (
  editorKey?: string,
): readonly SlashCommand[] => {
  const { open: openDrawio } = useDrawioModalForEditorActions();
  const { open: openLink } = useLinkEditModalActions();
  const { open: openTableBuilder } = useHandsontableModalForEditorActions();

  const openersRef = useRef<ExtendedElementModalOpeners>({
    openDrawio,
    openLink,
    openTableBuilder,
  });
  openersRef.current = { openDrawio, openLink, openTableBuilder };

  return useMemo(
    () => buildExtendedElementCommands(editorKey, openersRef.current),
    [editorKey],
  );
};
