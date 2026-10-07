import { useCallback, useLayoutEffect } from 'react';
import { useRouter } from 'next/router';
import { atom, useAtomValue, useSetAtom } from 'jotai';

// Type definitions
type CommentEditorDirtyMapData = Map<string, boolean>;

// Internal atoms
const commentEditorDirtyMapAtom = atom<CommentEditorDirtyMapData>(new Map());

// Derived atom for unsaved warning state
const isUnsavedWarningEnabledAtom = atom((get) => {
  const dirtyMap = get(commentEditorDirtyMapAtom);
  return dirtyMap.size > 0;
});

// Hook 1: Read warning state + global control (for UnsavedAlertDialog)
export const useUnsavedWarning = () => {
  const router = useRouter();
  const isEnabled = useAtomValue(isUnsavedWarningEnabledAtom);
  const setDirtyMap = useSetAtom(commentEditorDirtyMapAtom);

  const reset = useCallback(() => {
    setDirtyMap(new Map());
  }, [setDirtyMap]);

  // Router event handling
  useLayoutEffect(() => {
    router.events.on('routeChangeComplete', reset);
    return () => {
      router.events.off('routeChangeComplete', reset);
    };
  }, [reset, router.events]);

  return { isEnabled, reset };
};
// Hook 2: Action-only hook (for CommentEditor)
export const useCommentEditorsDirtyMap = () => {
  const setDirtyMap = useSetAtom(commentEditorDirtyMapAtom);

  const markDirty = useCallback(
    (editorKey: string, content: string) => {
      setDirtyMap((current) => {
        const newMap = new Map(current);
        if (content.length === 0) {
          newMap.delete(editorKey);
        } else {
          newMap.set(editorKey, true);
        }
        return newMap;
      });
    },
    [setDirtyMap],
  );

  const markClean = useCallback(
    (editorKey: string) => {
      setDirtyMap((current) => {
        const newMap = new Map(current);
        newMap.delete(editorKey);
        return newMap;
      });
    },
    [setDirtyMap],
  );

  return { markDirty, markClean };
};
