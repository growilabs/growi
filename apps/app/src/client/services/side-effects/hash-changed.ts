import { useCallback, useEffect } from 'react';

import { useRouter } from 'next/router';

import { useIsEditable } from '~/stores-universal/context';
import { useEditorMode, determineEditorModeByHash } from '~/stores-universal/ui';

/**
 * Change editorMode by browser forward/back operation
 */
export const useHashChangedEffect = (): void => {
  const router = useRouter();

  const { data: isEditable } = useIsEditable();
  const { data: editorMode, mutate: mutateEditorMode } = useEditorMode();

  const hashchangeHandler = useCallback(() => {
    const newEditorMode = determineEditorModeByHash();

    if (editorMode !== newEditorMode) {
      mutateEditorMode(newEditorMode);
    }
  }, [editorMode, mutateEditorMode]);

  // setup effect
  useEffect(() => {
    if (!isEditable) {
      return;
    }

    window.addEventListener('hashchange', hashchangeHandler);

    // return remove handler
    return function cleanup() {
      window.removeEventListener('hashchange', hashchangeHandler);
    };

  }, [hashchangeHandler, isEditable]);

  /*
  * Route changes by Next Router
  * https://nextjs.org/docs/api-reference/next/router
  */
  useEffect(() => {
    router.events.on('routeChangeComplete', hashchangeHandler);

    return () => {
      router.events.off('routeChangeComplete', hashchangeHandler);
    };
  }, [hashchangeHandler, router.events]);
};
