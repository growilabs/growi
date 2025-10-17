import { useCallback, useEffect } from 'react';

import { Origin } from '@growi/core';
import { GlobalCodeMirrorEditorKey } from '@growi/editor';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';
import { useTranslation } from 'react-i18next';

import type { Save, SaveOptions } from '~/client/components/PageEditor/PageEditor';
import { useUpdateStateAfterSave } from '~/client/services/page-operation';
import { toastSuccess } from '~/client/util/toastr';
import { SocketEventName } from '~/interfaces/websocket';
import type { RemoteRevisionData } from '~/states/page';
import { useCurrentPageData, useCurrentPageId, useSetRemoteLatestPageData } from '~/states/page';
import { useGlobalSocket } from '~/states/socket-io';
import { EditorMode, useEditorMode } from '~/states/ui/editor';
import { useConflictDiffModalActions } from '~/states/ui/modal/conflict-diff';
import { usePageStatusAlertActions } from '~/states/ui/modal/page-status-alert';


export type ConflictHandler = (
  remoteRevisionData: RemoteRevisionData,
  requestMarkdown: string,
  save: Save,
  saveOptions?: SaveOptions,
) => void;

type GenerateResolveConflicthandler = () => (
  revisionId: string,
  save: Save,
  saveOptions?: SaveOptions,
  onConflict?: () => void
) => (newMarkdown: string) => Promise<void>

const useGenerateResolveConflictHandler: GenerateResolveConflicthandler = () => {
  const { t } = useTranslation();

  const pageId = useCurrentPageId();
  const { close: closePageStatusAlert } = usePageStatusAlertActions();
  const { close: closeConflictDiffModal } = useConflictDiffModalActions();
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(GlobalCodeMirrorEditorKey.MAIN);
  const updateStateAfterSave = useUpdateStateAfterSave(pageId, { supressEditingMarkdownMutation: true });

  return useCallback((revisionId, save, saveOptions, onConflict) => {
    return async (newMarkdown) => {
      const page = await save(revisionId, newMarkdown, saveOptions, onConflict);
      if (page == null) {
        return;
      }

      // Reflect conflict resolution results in CodeMirrorEditor
      codeMirrorEditor?.initDoc(newMarkdown);

      closePageStatusAlert();
      closeConflictDiffModal();

      toastSuccess(t('toaster.save_succeeded'));
      updateStateAfterSave?.();
    };
  }, [closeConflictDiffModal, closePageStatusAlert, codeMirrorEditor, t, updateStateAfterSave]);
};


type ConflictResolver = () => ConflictHandler;

export const useConflictResolver: ConflictResolver = () => {
  const { open: openPageStatusAlert } = usePageStatusAlertActions();
  const { open: openConflictDiffModal } = useConflictDiffModalActions();
  const setRemoteLatestPageData = useSetRemoteLatestPageData();
  const generateResolveConflictHandler = useGenerateResolveConflictHandler();

  return useCallback((remoteRevidsionData, requestMarkdown, save, saveOptions) => {
    const conflictHandler = () => {
      const resolveConflictHandler = generateResolveConflictHandler(remoteRevidsionData.remoteRevisionId, save, saveOptions, conflictHandler);
      openPageStatusAlert({ onResolveConflict: () => openConflictDiffModal(requestMarkdown, resolveConflictHandler) });
      setRemoteLatestPageData(remoteRevidsionData);
    };

    conflictHandler();
  }, [generateResolveConflictHandler, openConflictDiffModal, openPageStatusAlert, setRemoteLatestPageData]);
};

export const useConflictEffect = (): void => {
  const currentPage = useCurrentPageData();
  const { close: closePageStatusAlert, open: openPageStatusAlert } = usePageStatusAlertActions();
  const { close: closeConflictDiffModal, open: openConflictDiffModal } = useConflictDiffModalActions();
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(GlobalCodeMirrorEditorKey.MAIN);
  const socket = useGlobalSocket();
  const { editorMode } = useEditorMode();

  const conflictHandler = useCallback(() => {
    const onResolveConflict = () => {
      const resolveConflictHandler = (newMarkdown: string) => {
        codeMirrorEditor?.initDoc(newMarkdown);
        closeConflictDiffModal();
        closePageStatusAlert();
      };

      const markdown = codeMirrorEditor?.getDocString();
      openConflictDiffModal(markdown ?? '', resolveConflictHandler);
    };

    openPageStatusAlert({ onResolveConflict });
  }, [closeConflictDiffModal, closePageStatusAlert, codeMirrorEditor, openConflictDiffModal, openPageStatusAlert]);

  const updateRemotePageDataHandler = useCallback((data) => {
    const { s2cMessagePageUpdated } = data;

    const remoteRevisionId = s2cMessagePageUpdated.revisionId;
    const remoteRevisionOrigin = s2cMessagePageUpdated.revisionOrigin;
    const currentRevisionId = currentPage?.revision?._id;
    const isRevisionOutdated = (currentRevisionId != null || remoteRevisionId != null) && currentRevisionId !== remoteRevisionId;

    // !!CAUTION!! Timing of calling openPageStatusAlert may clash with client/services/side-effects/page-updated.ts
    if (isRevisionOutdated && editorMode === EditorMode.Editor && (remoteRevisionOrigin === Origin.View || remoteRevisionOrigin === undefined)) {
      conflictHandler();
    }

    // Clear cache
    if (!isRevisionOutdated) {
      closePageStatusAlert();
    }
  }, [closePageStatusAlert, currentPage?.revision?._id, editorMode, conflictHandler]);

  useEffect(() => {
    if (socket == null) { return }

    socket.on(SocketEventName.PageUpdated, updateRemotePageDataHandler);

    return () => {
      socket.off(SocketEventName.PageUpdated, updateRemotePageDataHandler);
    };

  }, [socket, updateRemotePageDataHandler]);
};
