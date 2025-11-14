import { useCallback, useEffect } from 'react';

import { useRouter } from 'next/router';

import { useIsEditable } from '~/states/page';
import { useEditorMode, determineEditorModeByHash } from '~/states/ui/editor';

/**
 * Change editorMode by browser forward/back operation
 */
export const useHashChangedEffect = (): void => {
  const router = useRouter();

  const isEditable = useIsEditable();
  const { editorMode, setEditorMode } = useEditorMode();

  const hashchangeHandler = useCallback(() => {
    const newEditorMode = determineEditorModeByHash();

    if (editorMode !== newEditorMode) {
      setEditorMode(newEditorMode);
    }
  }, [editorMode, setEditorMode]);

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
