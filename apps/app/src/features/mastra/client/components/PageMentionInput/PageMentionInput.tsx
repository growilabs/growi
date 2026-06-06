import { useCallback, useEffect, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { LinkedPagePath } from '~/models/linked-page-path';
import { cn } from '~/utils/shadcn-ui';

import {
  createPageMentionExtensions,
  getMentionFlattenedText,
  mentionSessionField,
} from './editor-state';
import { MentionCandidateList } from './MentionCandidateList';
import type {
  MentionController,
  MentionData,
  MentionSessionState,
  PageMentionInputProps,
} from './types';
import { useMentionController } from './use-mention-controller';

const INACTIVE_SESSION: MentionSessionState = {
  active: false,
  from: -1,
  to: -1,
  query: '',
};

// Minimal theme approximating the prior textarea look (borderless, transparent;
// the shadcn PromptInput shell owns the surrounding chrome).
const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-content': { padding: '0', fontFamily: 'inherit' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '&.cm-focused': { outline: 'none' },
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
  disabled,
}: PageMentionInputProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Compartment so editability can be reconfigured when `disabled` changes
  // without recreating the view.
  const editableCompartmentRef = useRef(new Compartment());

  // The mounted view, exposed to React so the controller and candidate list can
  // read from it. Set once the view is created in the mount effect.
  const [view, setView] = useState<EditorView | null>(null);

  // React-side mirror of the doc-derived mention session (the CM→React bridge).
  const [session, setSession] = useState<MentionSessionState>(INACTIVE_SESSION);

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

  const navigate = useCallback((data: MentionData) => {
    const { href } = new LinkedPagePath(data.path);
    // Open in a NEW TAB so the in-progress chat draft is preserved (4.1).
    window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

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
          // Initialised editable; the `disabled` effect reconfigures this
          // compartment (reading `disabled` here would force a remount).
          editableCompartmentRef.current.of(EditorView.editable.of(true)),
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

  // Reflect the disabled prop onto the editor's editability.
  useEffect(() => {
    const v = viewRef.current;
    if (v == null) {
      return;
    }
    v.dispatch({
      effects: editableCompartmentRef.current.reconfigure(
        EditorView.editable.of(!disabled),
      ),
    });
  }, [disabled]);

  return (
    <div className="tw:relative tw:w-full">
      <div
        ref={containerRef}
        data-slot="page-mention-input"
        data-placeholder={placeholder}
        className={cn(
          'tw:w-full tw:text-sm',
          disabled && 'tw:pointer-events-none tw:opacity-50',
        )}
      />

      {/* Carries the flattened submit text to the existing form path (6.1). */}
      <input type="hidden" name="message" value={flattened} readOnly />

      <MentionCandidateList controller={controller} />
    </div>
  );
};
