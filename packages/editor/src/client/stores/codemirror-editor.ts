import { useEffect, useMemo, useRef } from 'react';
import { deepEquals } from '@growi/core/dist/utils';
import type {
  ReactCodeMirrorProps,
  UseCodeMirror,
} from '@uiw/react-codemirror';
import { atom, useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import deepmerge from 'ts-deepmerge';

import { type UseCodeMirrorEditor, useCodeMirrorEditor } from '../services';

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

  const shouldUpdate =
    key != null &&
    container != null &&
    (currentData == null ||
      (isValid(newData) && !isDeepEquals(currentData, newData)));

  // Update atom when data changes
  useEffect(() => {
    if (shouldUpdate) {
      ref.current = newData;
      setStoredData(newData);
    }
  }, [shouldUpdate, newData, setStoredData]);

  return {
    data: key != null ? (storedData ?? undefined) : undefined,
  };
};
