import { useCallback, useEffect } from 'react';

import { SocketEventName } from '~/interfaces/websocket';
import type { RemoteRevisionData } from '~/states/page';
import {
  useCurrentPageData,
  useFetchCurrentPage,
  useSetRemoteLatestPageData,
} from '~/states/page';
import { useGlobalSocket } from '~/states/socket-io';
import { EditorMode, useEditorMode } from '~/states/ui/editor';
import { usePageStatusAlertActions } from '~/states/ui/modal/page-status-alert';
import { useSWRxPageInfo } from '~/stores/page';

export const usePageUpdatedEffect = (): void => {
  const setRemoteLatestPageData = useSetRemoteLatestPageData();

  const socket = useGlobalSocket();
  const { editorMode } = useEditorMode();
  const currentPage = useCurrentPageData();
  const { fetchCurrentPage } = useFetchCurrentPage();
  const { open: openPageStatusAlert, close: closePageStatusAlert } =
    usePageStatusAlertActions();

  const { mutate: mutatePageInfo } = useSWRxPageInfo(currentPage?._id);

  const remotePageDataUpdateHandler = useCallback(
    (data) => {
      // Set remote page data
      const { s2cMessagePageUpdated } = data;

      const remoteData: RemoteRevisionData = {
        remoteRevisionId: s2cMessagePageUpdated.revisionId,
        remoteRevisionBody: s2cMessagePageUpdated.revisionBody,
        remoteRevisionLastUpdateUser:
          s2cMessagePageUpdated.remoteLastUpdateUser,
        remoteRevisionLastUpdatedAt: s2cMessagePageUpdated.revisionUpdateAt,
      };

      if (
        currentPage?._id != null &&
        currentPage._id === s2cMessagePageUpdated.pageId
      ) {
        setRemoteLatestPageData(remoteData);

        // Update PageInfo cache
        mutatePageInfo();

        // Open PageStatusAlert
        const currentRevisionId = currentPage?.revision?._id;
        const remoteRevisionId = s2cMessagePageUpdated.revisionId;
        const isRevisionOutdated =
          (currentRevisionId != null || remoteRevisionId != null) &&
          currentRevisionId !== remoteRevisionId;

        // !!CAUTION!! Timing of calling openPageStatusAlert may clash with components/PageEditor/conflict.tsx
        if (isRevisionOutdated && editorMode === EditorMode.View) {
          openPageStatusAlert({
            hideEditorMode: EditorMode.Editor,
            onRefleshPage: () => fetchCurrentPage({ force: true }),
          });
        }

        // Clear cache
        if (!isRevisionOutdated) {
          closePageStatusAlert();
        }
      }
      // eslint-disable-next-line max-len
    },
    [
      currentPage?._id,
      currentPage?.revision?._id,
      setRemoteLatestPageData,
      mutatePageInfo,
      editorMode,
      openPageStatusAlert,
      fetchCurrentPage,
      closePageStatusAlert,
    ],
  );

  // listen socket for someone updating this page
  useEffect(() => {
    if (socket == null) {
      return;
    }

    socket.on(SocketEventName.PageUpdated, remotePageDataUpdateHandler);

    return () => {
      socket.off(SocketEventName.PageUpdated, remotePageDataUpdateHandler);
    };
  }, [remotePageDataUpdateHandler, socket]);
};
