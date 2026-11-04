import { useEffect, useMemo, useRef } from 'react';
import { deepEquals } from '@growi/core/dist/utils';
import type {
  ReactCodeMirrorProps,
  UseCodeMirror,
} from '@uiw/react-codemirror';
import { atom, useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import deepmerge from 'ts-deepmerge';

import {
  type UseCodeMirrorEditor,
  useCodeMirrorEditor,
} from '../services/index.js';

const { isDeepEquals } = deepEquals;

const isValid = (u: UseCodeMirrorEditor) => {
  return u.state != null && u.view != null;
};

/**
 * Atom family to store CodeMirror editor instances by key
 */
const codeMirrorEditorAtomFamily = atomFamily((_key: string) =>
  atom<UseCodeMirrorEditor | null>(null),
);

/**
 * Result type for useCodeMirrorEditorIsolated hook
 * Compatible with the previous SWRResponse interface for the data field
 */
export type CodeMirrorEditorResult = {
  data: UseCodeMirrorEditor | undefined;
};

/**
 * Hook to manage isolated CodeMirror editor instances using Jotai
 */
export const useCodeMirrorEditorIsolated = (
  key: string | null,
  container?: HTMLDivElement | null,
  props?: ReactCodeMirrorProps,
): CodeMirrorEditorResult => {
  const ref = useRef<UseCodeMirrorEditor | null>(null);
  const currentData = ref.current;

  // Use a default key if null is provided
  const atomKey = key ?? 'default';
  const [storedData, setStoredData] = useAtom(
    codeMirrorEditorAtomFamily(atomKey),
  );

  const mergedProps = useMemo<UseCodeMirror>(
    () => deepmerge({ container }, props ?? {}),
    [container, props],
  );

  const newData = useCodeMirrorEditor(mergedProps);

  // An incomplete editor must never reach the shared atom -- not even as the
  // first published value. @uiw/react-codemirror initializes view/state via
  // useState, so they are still undefined on the render right after the
  // container element attaches. Consumers that apply an initial value exactly
  // once (e.g. MentionAwareCommentInput) would spend that single chance on a
  // no-op initDoc against a view-less editor.
  const shouldUpdate =
    key != null &&
    container != null &&
    isValid(newData) &&
    (currentData == null || !isDeepEquals(currentData, newData));

  // Update atom when data changes
  useEffect(() => {
    if (shouldUpdate) {
      ref.current = newData;
      setStoredData(newData);
    }
  }, [shouldUpdate, newData, setStoredData]);

  // Reset the atom when the *publisher* (the hook instance that actually owns
  // a `container`, e.g. CodeMirrorEditor) unmounts -- otherwise a remount
  // with the same key (re-opening edit mode on the same comment after
  // Cancel) sees the atom still holding the PREVIOUS, now-destroyed editor
  // on its very first render. A consumer that applies its initial value only
  // once (MentionAwareCommentInput) would spend that one chance on the dead
  // editor and never retry once the real one re-publishes.
  //
  // Gated through a ref rather than the `container` value directly, for two
  // reasons: `container` captured in an empty-dep effect would be stale, and
  // the gate itself is required at all -- MentionAwareCommentInput calls this
  // hook with no `container` (a pure reader sharing the publisher's key), and
  // an ungated reset would let a reader wipe a still-live editor out from
  // under the publisher on every one of ITS unmounts too.
  const isPublisherRef = useRef(false);
  isPublisherRef.current = container != null;
  useEffect(() => {
    return () => {
      if (isPublisherRef.current) {
        setStoredData(null);
      }
    };
  }, [setStoredData]);

  return {
    data: key != null ? (storedData ?? undefined) : undefined,
  };
};
