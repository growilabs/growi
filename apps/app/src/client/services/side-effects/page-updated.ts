import { useCallback, useEffect } from 'react';

import { SocketEventName } from '~/interfaces/websocket';
import { useCurrentPageData, useFetchCurrentPage, useSetRemoteLatestPageData } from '~/states/page';
import type { RemoteRevisionData } from '~/states/page';
import { useGlobalSocket } from '~/states/socket-io';
import { useEditorMode, EditorMode } from '~/states/ui/editor';
import { usePageStatusAlertActions } from '~/states/ui/modal/page-status-alert';


export const usePageUpdatedEffect = (): void => {

  const setRemoteLatestPageData = useSetRemoteLatestPageData();

  const socket = useGlobalSocket();
  const { editorMode } = useEditorMode();
  const currentPage = useCurrentPageData();
  const { fetchCurrentPage } = useFetchCurrentPage();
  const { open: openPageStatusAlert, close: closePageStatusAlert } = usePageStatusAlertActions();

  const remotePageDataUpdateHandler = useCallback((data) => {
    // Set remote page data
    const { s2cMessagePageUpdated } = data;

    const remoteData: RemoteRevisionData = {
      remoteRevisionId: s2cMessagePageUpdated.revisionId,
      remoteRevisionBody: s2cMessagePageUpdated.revisionBody,
      remoteRevisionLastUpdateUser: s2cMessagePageUpdated.remoteLastUpdateUser,
      remoteRevisionLastUpdatedAt: s2cMessagePageUpdated.revisionUpdateAt,
    };

    if (currentPage?._id != null && currentPage._id === s2cMessagePageUpdated.pageId) {
      setRemoteLatestPageData(remoteData);

      // Open PageStatusAlert
      const currentRevisionId = currentPage?.revision?._id;
      const remoteRevisionId = s2cMessagePageUpdated.revisionId;
      const isRevisionOutdated = (currentRevisionId != null || remoteRevisionId != null) && currentRevisionId !== remoteRevisionId;

      // !!CAUTION!! Timing of calling openPageStatusAlert may clash with components/PageEditor/conflict.tsx
      if (isRevisionOutdated && editorMode === EditorMode.View) {
        openPageStatusAlert({ hideEditorMode: EditorMode.Editor, onRefleshPage: fetchCurrentPage });
      }

      // Clear cache
      if (!isRevisionOutdated) {
        closePageStatusAlert();
      }
    }
  }, [currentPage?._id, currentPage?.revision?._id, editorMode, fetchCurrentPage, openPageStatusAlert, closePageStatusAlert, setRemoteLatestPageData]);

  // listen socket for someone updating this page
  useEffect(() => {

    if (socket == null) { return }

    socket.on(SocketEventName.PageUpdated, remotePageDataUpdateHandler);

    return () => {
      socket.off(SocketEventName.PageUpdated, remotePageDataUpdateHandler);
    };

  }, [remotePageDataUpdateHandler, socket]);
};
