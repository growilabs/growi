import type { Extension, StateEffectType } from '@codemirror/state';
import { Facet, StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

import type { MentionData } from '../types';

/**
 * Facet collecting navigation handlers invoked when a mention chip is clicked
 * (Requirement 4.1). Each registered callback receives the chip's MentionData.
 * The decoration layer deliberately knows nothing about routing — navigation is
 * supplied by the consumer (e.g. the React adapter via LinkedPagePath).
 */
export const mentionNavCallback = Facet.define<(data: MentionData) => void>();

/**
 * Effect that registers an atomic mention chip over the document range
 * [from, to] (Requirement 3.1). `from..to` must cover the path string that has
 * already been written into the doc.
 */
export const addMention: StateEffectType<{
  from: number;
  to: number;
  data: MentionData;
}> = StateEffect.define<{ from: number; to: number; data: MentionData }>();

/**
 * Inline widget rendering a committed mention as a visually distinct,
 * clickable chip (Requirements 3.2, 4.1, 4.2).
 *
 * The path is set via `textContent` only — never `innerHTML` — so a path that
 * happens to contain markup is rendered literally and cannot inject DOM (4.2 /
 * security).
 */
class MentionWidget extends WidgetType {
  constructor(readonly data: MentionData) {
    super();
  }

  /**
   * Two widgets are equal when they reference the same page, so an unchanged
   * mention is not needlessly re-rendered.
   */
  override eq(other: MentionWidget): boolean {
    return (
      this.data.path === other.data.path &&
      this.data.pageId === other.data.pageId
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement('span');
    chip.dataset.mention = '';
    // Visually distinct chip (3.2): background, rounded corners, padding.
    chip.className =
      'tw:inline-flex tw:items-center tw:rounded tw:bg-primary/10 tw:px-1 tw:text-primary tw:cursor-pointer';
    // Path rendered as text — no HTML injection (4.2 / security).
    chip.textContent = this.data.path;

    // Suppress the editor's default caret placement so a click on the chip is
    // a navigation gesture rather than a cursor move (distinguishes click from
    // edit — 4.2).
    chip.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    chip.addEventListener('click', () => {
      for (const callback of view.state.facet(mentionNavCallback)) {
        callback(this.data);
      }
    });

    return chip;
  }

  /**
   * Let the events we handle (mousedown/click) reach our own DOM listeners
   * instead of being swallowed by the editor.
   */
  override ignoreEvent(): boolean {
    return false;
  }
}

const buildMentionDecoration = (data: MentionData): Decoration =>
  // `inclusive: false` keeps text typed immediately adjacent to the chip
  // outside the decoration, i.e. plain text (Requirement 5.4).
  Decoration.replace({ widget: new MentionWidget(data), inclusive: false });

/**
 * StateField holding the set of mention chip decorations (Requirements 3.1,
 * 3.4, 5.2). Existing decorations follow document edits via `map`; `addMention`
 * effects register new ones.
 */
export const mentionDecorationField: StateField<DecorationSet> =
  StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(deco, tr) {
      // Position follow on edits (5.2). A decoration whose range is fully
      // deleted is dropped by `map`, turning a broken chip back into nothing.
      let next = deco.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(addMention)) {
          const { from, to, data } = effect.value;
          next = next.update({
            add: [buildMentionDecoration(data).range(from, to)],
          });
        }
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

/**
 * Provides each mention range as an atomic unit so the caret treats it as one
 * token: the caret rests only at the boundaries, character-wise editing inside
 * is impossible, and a single delete removes the whole range (Requirements 3.3,
 * 5.1, 5.3).
 */
const mentionAtomicRanges: Extension = EditorView.atomicRanges.of((view) =>
  view.state.field(mentionDecorationField),
);

/**
 * Composed extension bundling the decoration field and its atomic-range
 * provider. Consumers install this single value; the field, effect and facet
 * remain individually exported for the controller/factory layer to compose.
 */
export const mentionDecorationExtension: Extension = [
  mentionDecorationField,
  mentionAtomicRanges,
];
