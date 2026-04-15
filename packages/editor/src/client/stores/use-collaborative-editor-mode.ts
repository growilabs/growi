import { useEffect, useState } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { YJS_WEBSOCKET_BASE_PATH } from '@growi/core/dist/consts';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { userColor } from '../../consts';
import type { EditingClient } from '../../interfaces';
import type { UseCodeMirrorEditor } from '../services';
import { yRichCursors } from '../services-internal/extensions/y-rich-cursors';
import { useSecondaryYdocs } from './use-secondary-ydocs';

type Awareness = WebsocketProvider['awareness'];

type AwarenessState = {
  editors?: EditingClient;
  cursor?: {
    anchor: Y.RelativePosition;
    head: Y.RelativePosition;
  };
};

type Configuration = {
  user?: IUserHasId;
  pageId?: string;
  reviewMode?: boolean;
  onEditorsUpdated?: (clientList: EditingClient[]) => void;
  onScrollToRemoteCursorReady?: (
    scrollFn: ((clientId: number) => void) | null,
  ) => void;
};

/**
 * Pure function that creates a scroll-to-remote-cursor callback.
 * Extracted for unit testability.
 *
 * @param awareness - Yjs awareness instance for reading remote cursor positions
 * @param activeDoc - The active Y.Doc used to resolve relative positions
 * @param getView - Lazy accessor for the CodeMirror EditorView
 */
export const createScrollToRemoteCursorFn = (
  awareness: Pick<Awareness, 'getStates'>,
  activeDoc: Y.Doc,
  getView: () => EditorView | undefined,
): ((clientId: number) => void) => {
  return (clientId: number) => {
    const state = awareness.getStates().get(clientId) as
      | AwarenessState
      | undefined;
    const cursor = state?.cursor;
    if (cursor?.head == null) return;

    const pos = Y.createAbsolutePositionFromRelativePosition(
      cursor.head,
      activeDoc,
    );
    if (pos == null) return;

    const view = getView();
    if (view == null) return;

    view.dispatch({
      effects: EditorView.scrollIntoView(pos.index, { y: 'center' }),
    });
  };
};

export const useCollaborativeEditorMode = (
  isEnabled: boolean,
  codeMirrorEditor?: UseCodeMirrorEditor,
  configuration?: Configuration,
): void => {
  const {
    user,
    pageId,
    onEditorsUpdated,
    reviewMode,
    onScrollToRemoteCursorReady,
  } = configuration ?? {};

  const { primaryDoc, activeDoc } =
    useSecondaryYdocs(isEnabled, {
      pageId,
      useSecondary: reviewMode,
    }) ?? {};

  const [provider, setProvider] = useState<WebsocketProvider>();

  // reset editors
  useEffect(() => {
    if (!isEnabled) return;
    onEditorsUpdated?.([]);
  }, [isEnabled, onEditorsUpdated]);

  // Setup provider
  useEffect(() => {
    if (!isEnabled || pageId == null || primaryDoc == null) {
      setProvider(undefined);
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const serverUrl = `${wsProtocol}//${window.location.host}${YJS_WEBSOCKET_BASE_PATH}`;

    const _provider = new WebsocketProvider(serverUrl, pageId, primaryDoc, {
      connect: true,
      resyncInterval: 3000,
    });

    const userLocalState: EditingClient = {
      clientId: primaryDoc.clientID,
      name: user?.name ?? `Guest User ${Math.floor(Math.random() * 100)}`,
      userId: user?._id,
      username: user?.username,
      imageUrlCached: user?.imageUrlCached,
      color: userColor.color,
      colorLight: userColor.light,
    };

    const { awareness } = _provider;
    awareness.setLocalStateField('editors', userLocalState);

    const emitEditorList = () => {
      if (onEditorsUpdated == null) return;
      const clientList = Array.from(awareness.getStates().values())
        .map((value) => value.editors)
        .filter((v): v is EditingClient => v != null);
      onEditorsUpdated(clientList);
    };

    const providerSyncHandler = (isSync: boolean) => {
      if (isSync) emitEditorList();
    };

    _provider.on('sync', providerSyncHandler);

    const updateAwarenessHandler = (_update: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      emitEditorList();
    };

    awareness.on('update', updateAwarenessHandler);

    setProvider(_provider);

    return () => {
      _provider.awareness.setLocalState(null);
      _provider.awareness.off('update', updateAwarenessHandler);
      _provider.off('sync', providerSyncHandler);
      _provider.disconnect();
      _provider.destroy();
    };
  }, [isEnabled, primaryDoc, onEditorsUpdated, pageId, user]);

  // Setup Ydoc Extensions
  useEffect(() => {
    if (
      !isEnabled ||
      !primaryDoc ||
      !activeDoc ||
      !provider ||
      !codeMirrorEditor
    ) {
      return;
    }

    const activeText = activeDoc.getText('codemirror');

    const undoManager = new Y.UndoManager(activeText);

    // initialize document with activeDoc text
    codeMirrorEditor.initDoc(activeText.toString());

    const extensions = [
      keymap.of(yUndoManagerKeymap),
      yCollab(activeText, null, { undoManager }),
      yRichCursors(provider.awareness),
    ];

    const cleanupFunctions = extensions.map((ext) =>
      codeMirrorEditor.appendExtensions([ext]),
    );

    return () => {
      cleanupFunctions.forEach((cleanup) => {
        cleanup?.();
      });
      codeMirrorEditor.initDoc('');
    };
  }, [isEnabled, codeMirrorEditor, provider, primaryDoc, activeDoc]);

  // Setup scroll-to-remote-cursor callback
  useEffect(() => {
    if (
      !isEnabled ||
      provider == null ||
      activeDoc == null ||
      codeMirrorEditor == null
    ) {
      onScrollToRemoteCursorReady?.(null);
      return;
    }

    const scrollFn = createScrollToRemoteCursorFn(
      provider.awareness,
      activeDoc,
      () => codeMirrorEditor.view,
    );

    onScrollToRemoteCursorReady?.(scrollFn);

    return () => {
      onScrollToRemoteCursorReady?.(null);
    };
  }, [
    isEnabled,
    provider,
    activeDoc,
    codeMirrorEditor,
    onScrollToRemoteCursorReady,
  ]);
};
