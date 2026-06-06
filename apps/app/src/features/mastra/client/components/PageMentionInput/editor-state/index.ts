import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { MentionController, MentionData } from '../types';
import {
  mentionDecorationExtension,
  mentionNavCallback,
} from './mention-decoration';
import { mentionControllerFacet, mentionKeymap } from './mention-keymap';
import { mentionSessionField } from './mention-session';

/**
 * Options for {@link createPageMentionExtensions}. These are the injection
 * points the React adapter (`PageMentionInput`) supplies to bridge the otherwise
 * framework-agnostic editor extensions back to React.
 */
export interface CreatePageMentionExtensionsOptions {
  /**
   * Getter resolving the *current* mention controller. A getter (not the value)
   * avoids the stale-closure trap: the keymap reads the latest controller on
   * each keypress rather than the one captured at editor-creation time.
   */
  getController: () => MentionController | null;
  /** Invoked when a committed mention chip is clicked (Requirement 4.1). */
  onNavigate: (data: MentionData) => void;
  /**
   * Invoked on every transaction with the live view so React can pull the
   * current session state (the CM→React bridge). Supplied by PageMentionInput.
   */
  onSessionChange?: (view: EditorView) => void;
}

/**
 * Compose all mention editor-state extensions into a single Extension
 * (Requirement 3.3): the session field, the decoration field + its
 * `EditorView.atomicRanges` provider, the high-precedence keymap, and the two
 * facets / update-listener that wire the inert extensions to the React layer.
 *
 * Precedence is already baked into the composed members (`mentionKeymap` is
 * `Prec.highest`, `mentionDecorationExtension` bundles the atomic-range
 * provider), so the consumer installs this one value without further wrapping.
 */
export const createPageMentionExtensions = (
  options: CreatePageMentionExtensionsOptions,
): Extension => {
  const { getController, onNavigate, onSessionChange } = options;

  return [
    mentionSessionField,
    mentionDecorationExtension,
    mentionKeymap,
    mentionNavCallback.of(onNavigate),
    mentionControllerFacet.of(getController),
    EditorView.updateListener.of((update) => {
      onSessionChange?.(update.view);
    }),
  ];
};

export { getMentionFlattenedText } from './flatten';
export { mentionSessionField } from './mention-session';
