import { useEffect, useState } from 'react';
import { keymap } from '@codemirror/view';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { SocketIOProvider } from 'y-socket.io';
import * as Y from 'yjs';

import { userColor } from '../../consts';
import type { EditingClient } from '../../interfaces';
import type { UseCodeMirrorEditor } from '../services';
import { useSecondaryYdocs } from './use-secondary-ydocs';

type Configuration = {
  user?: IUserHasId;
  pageId?: string;
  reviewMode?: boolean;
  onEditorsUpdated?: (clientList: EditingClient[]) => void;
};

export const useCollaborativeEditorMode = (
  isEnabled: boolean,
  codeMirrorEditor?: UseCodeMirrorEditor,
  configuration?: Configuration,
): void => {
  const { user, pageId, onEditorsUpdated, reviewMode } = configuration ?? {};

  const { primaryDoc, activeDoc } =
    useSecondaryYdocs(isEnabled, {
      pageId,
      useSecondary: reviewMode,
    }) ?? {};

  const [provider, setProvider] = useState<SocketIOProvider>();

  // reset editors
  useEffect(() => {
    if (!isEnabled) return;
    onEditorsUpdated?.([]);
  }, [isEnabled, onEditorsUpdated]);

  // Setup provider
  useEffect(() => {
    let _provider: SocketIOProvider | undefined;
    let providerSyncHandler: (isSync: boolean) => void;
    let updateAwarenessHandler: (update: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => void;

    setProvider(() => {
      if (!isEnabled || pageId == null || primaryDoc == null) {
        return undefined;
      }

      _provider = new SocketIOProvider('/', pageId, primaryDoc, {
        autoConnect: true,
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

      providerSyncHandler = (isSync: boolean) => {
        if (isSync && onEditorsUpdated != null) {
          const clientList: EditingClient[] = Array.from(
            awareness.getStates().values(),
            (value) => value.editors,
          );
          if (Array.isArray(clientList)) {
            onEditorsUpdated(clientList);
          }
        }
      };

      _provider.on('sync', providerSyncHandler);

      // update args type see: SocketIOProvider.Awareness.awarenessUpdate
      updateAwarenessHandler = (update: {
        added: number[];
        updated: number[];
        removed: number[];
      }) => {
        // remove the states of disconnected clients
        update.removed.forEach((clientId) => awareness.states.delete(clientId));

        // update editor list
        if (onEditorsUpdated != null) {
          const clientList: EditingClient[] = Array.from(
            awareness.states.values(),
            (value) => value.editors,
          );
          if (Array.isArray(clientList)) {
            onEditorsUpdated(clientList);
          }
        }
      };

      awareness.on('update', updateAwarenessHandler);

      return _provider;
    });

    return () => {
      _provider?.awareness.setLocalState(null);
      _provider?.awareness.off('update', updateAwarenessHandler);
      _provider?.off('sync', providerSyncHandler);
      _provider?.disconnect();
      _provider?.destroy();
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
      yCollab(activeText, provider.awareness, { undoManager }),
    ];

    const cleanupFunctions = extensions.map((ext) =>
      codeMirrorEditor.appendExtensions([ext]),
    );

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup?.());
      codeMirrorEditor.initDoc('');
    };
  }, [isEnabled, codeMirrorEditor, provider, primaryDoc, activeDoc]);
};
