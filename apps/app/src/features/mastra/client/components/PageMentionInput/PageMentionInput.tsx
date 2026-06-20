import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { defaultKeymap } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import {
  placeholder as cmPlaceholder,
  EditorView,
  keymap,
} from '@codemirror/view';

import { LinkedPagePath } from '~/models/linked-page-path';

import {
  createPageMentionExtensions,
  getMentionFlattenedText,
  INACTIVE_MENTION_SESSION,
  mentionSessionField,
} from './editor-state';
import { MentionCandidateList } from './MentionCandidateList';
import {
  isListboxRendered,
  MENTION_LISTBOX_ID,
  mentionOptionId,
} from './mention-aria';
import type {
  MentionController,
  MentionData,
  MentionSessionState,
  PageMentionInputProps,
} from './types';
import { useMentionController } from './use-mention-controller';

// Theme approximating the prior textarea look (borderless, transparent; the
// shadcn PromptInput shell owns the surrounding chrome). Min-height raises the
// default input height (~ the old textarea's min-h-16) and the scroller caps
// growth with a scroll (~ the old max-h-48). Focus highlight is provided by the
// host InputGroup (see contentAttributes data-slot below), so the editor itself
// stays outline-less.
const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-content': {
    // padding (top right bottom left): nudge the caret/text start slightly down
    // (a bit more top padding) and slightly left (a bit less left padding).
    padding: '12px 12px 8px 8px',
    fontFamily: 'inherit',
    minHeight: '4rem',
    // Inherit the ambient (themed) text color so the native caret — which
    // defaults to the text color — follows light/dark mode instead of CodeMirror's
    // default black.
    color: 'inherit',
    caretColor: 'currentColor',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    maxHeight: '12rem',
    overflowY: 'auto',
  },
  '&.cm-focused': { outline: 'none' },
});

// Marks the editable content as the InputGroup's focus target so the host
// InputGroup applies its focus ring when the editor is focused (the old textarea
// carried this data-slot). `:focus-visible` matches editable content on focus.
const contentDataSlot = EditorView.contentAttributes.of({
  'data-slot': 'input-group-control',
});

/**
 * Thin React adapter bridging a CodeMirror `EditorView` (the input source of
 * truth) to the shadcn `PromptInput` host form. The editor owns the document;
 * React only mirrors derived state (the mention session) and the flattened
 * submit text.
 *
 * Submission is intentionally NOT a prop: the keymap calls
 * `view.dom.closest('form').requestSubmit()`. This component just renders inside
 * the host form (placed by ChatSidebar inside `PromptInputBody`) and exposes the
 * flattened text through a hidden `input[name="message"]` so the existing
 * `formData.get('message')` submit path reads it (Requirement 6.1).
 */
export const PageMentionInput = ({
  value,
  onChange,
  placeholder,
}: PageMentionInputProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Compartment for the combobox ARIA attributes on the editor's contentDOM
  // (aria-controls / aria-activedescendant), reconfigured as the candidate
  // session opens/closes and the highlight moves (#10).
  const ariaCompartmentRef = useRef(new Compartment());

  // Compartment for the placeholder text. The view is created once, but the
  // placeholder prop can change after mount (i18n resources load asynchronously,
  // locale switches), so it must be reconfigurable rather than baked in.
  const placeholderCompartmentRef = useRef(new Compartment());

  // The mounted view, exposed to React so the controller and candidate list can
  // read from it. Set once the view is created in the mount effect.
  const [view, setView] = useState<EditorView | null>(null);

  // React-side mirror of the doc-derived mention session (the CM→React bridge).
  const [session, setSession] = useState<MentionSessionState>(
    INACTIVE_MENTION_SESSION,
  );

  // Flattened submit text — the single source for both onChange and the hidden
  // input. Derived from the doc, never round-tripped through the `value` prop,
  // so submit reads the freshest value without a render lag (6.1).
  const [flattened, setFlattened] = useState('');

  // Mirror of `flattened` for synchronous comparison inside the update listener
  // (state reads inside a CM callback would be stale within the same tick).
  const flattenedRef = useRef('');

  const controller = useMentionController(view, session);

  // Stable ref to the latest controller. The keymap reads it through the facet
  // getter, so the view (created once) always delegates to the current
  // controller instance rather than a stale closure.
  const controllerRef = useRef<MentionController | null>(controller);
  controllerRef.current = controller;

  // Latest onChange, so the update listener (registered once) always calls the
  // current callback without recreating the view.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const router = useRouter();
  const navigate = useCallback(
    (data: MentionData) => {
      const { href } = new LinkedPagePath(data.path);
      // Navigate within the SPA via Next.js routing (4.1).
      router.push(href);
    },
    [router],
  );

  // EditorView lifecycle: create once on mount, destroy on unmount. The bridges
  // read refs, so the dep array is intentionally empty (the view is never
  // recreated for prop changes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: view is created once; bridges read refs
  useEffect(() => {
    const parent = containerRef.current;
    if (parent == null) {
      return;
    }

    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorView.lineWrapping,
          editorTheme,
          contentDataSlot,
          placeholderCompartmentRef.current.of(
            cmPlaceholder(placeholder ?? ''),
          ),
          // Combobox ARIA attributes; reconfigured by the effect below. Closed
          // initially (no listbox to reference).
          ariaCompartmentRef.current.of(EditorView.contentAttributes.of({})),
          createPageMentionExtensions({
            getController: () => controllerRef.current,
            onNavigate: navigate,
            // CM→React bridge: push session + flattened text on each update.
            onSessionChange: (v) => {
              setSession(v.state.field(mentionSessionField));
              const next = getMentionFlattenedText(v.state);
              if (flattenedRef.current !== next) {
                flattenedRef.current = next;
                setFlattened(next);
                onChangeRef.current(next);
              }
            },
          }),
          // Standard cursor-motion / editing keymap. The mention keymap is
          // Prec.highest and returns false when no session is active, so arrows
          // fall through to these. CodeMirror then owns caret motion on the doc
          // model: ArrowRight in an empty doc no-ops (no jumping over the
          // placeholder widget), and horizontal motion consults atomicRanges so
          // the caret treats a mention chip as one unit.
          keymap.of(defaultKeymap),
        ],
      }),
    });

    viewRef.current = created;
    setView(created);

    return () => {
      created.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, []);

  // Previous `value` prop, to detect the external-reset transition (→ '').
  const prevValueRef = useRef(value);

  // value → doc reset (external reset only). React to the parent clearing
  // `value` (post-submit). Only a transition to '' resets the doc — a steady
  // empty value never does, so editor-driven input (where the parent mirrors
  // the flattened text) is left untouched. Mentions are never reconstructed
  // from `value`; the editor doc is the source of truth.
  useEffect(() => {
    const prevValue = prevValueRef.current;
    prevValueRef.current = value;

    const v = viewRef.current;
    if (v == null) {
      return;
    }
    const becameEmpty = value === '' && prevValue !== '';
    if (becameEmpty && v.state.doc.length > 0) {
      flattenedRef.current = '';
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' } });
    }
  }, [value]);

  // placeholder → editor sync. The i18n resource may resolve after mount (or
  // the locale may switch), so reconfigure the placeholder extension whenever
  // the prop changes instead of relying on the editor-creation value.
  useEffect(() => {
    const v = viewRef.current;
    if (v == null) {
      return;
    }
    v.dispatch({
      effects: placeholderCompartmentRef.current.reconfigure(
        cmPlaceholder(placeholder ?? ''),
      ),
    });
  }, [placeholder]);

  // Combobox ARIA bridge (#10): expose `aria-controls` (the listbox) and
  // `aria-activedescendant` (the highlighted option) on the editor's contentDOM
  // so screen readers announce the active candidate during keyboard navigation.
  //
  // Emit them ONLY while the listbox and its options are actually in the DOM —
  // `isListboxRendered` is the same predicate MentionCandidateList renders the
  // listbox under, so the referenced ids can never dangle (#2).
  const listboxVisible = isListboxRendered(controller);
  useEffect(() => {
    const v = viewRef.current;
    if (v == null) {
      return;
    }
    const attrs: Record<string, string> = listboxVisible
      ? {
          'aria-controls': MENTION_LISTBOX_ID,
          'aria-activedescendant': mentionOptionId(controller.highlightedIndex),
        }
      : {};
    v.dispatch({
      effects: ariaCompartmentRef.current.reconfigure(
        EditorView.contentAttributes.of(attrs),
      ),
    });
  }, [listboxVisible, controller.highlightedIndex]);

  return (
    <div className="tw:relative tw:w-full">
      <div
        ref={containerRef}
        data-slot="page-mention-input"
        className="tw:w-full tw:text-sm"
      />

      {/* Carries the flattened submit text to the existing form path (6.1). */}
      <input type="hidden" name="message" value={flattened} readOnly />

      <MentionCandidateList controller={controller} />
    </div>
  );
};
