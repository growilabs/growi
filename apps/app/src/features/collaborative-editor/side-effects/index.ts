import { useEffect } from 'react';

import { useCurrentPageYjsDataActions } from '~/features/collaborative-editor/states';
import { SocketEventName } from '~/interfaces/websocket';
import { useIsGuestUser } from '~/states/context';
import {
  useCurrentPageData,
  useCurrentPageId,
  usePageNotFound,
} from '~/states/page';
import { useGlobalSocket } from '~/states/socket-io';

export const useCurrentPageYjsDataAutoLoadEffect = (): void => {
  const { fetchCurrentPageYjsData } = useCurrentPageYjsDataActions();
  const pageId = useCurrentPageId();
  const currentPage = useCurrentPageData();
  const isGuestUser = useIsGuestUser();
  const isNotFound = usePageNotFound();

  // Optimized effects with minimal dependencies
  useEffect(() => {
    // Load YJS data only when revision changes and page exists
    if (
      !isGuestUser &&
      pageId != null &&
      currentPage?.revision?._id != null &&
      !isNotFound
    ) {
      fetchCurrentPageYjsData();
    }
  }, [
    isGuestUser,
    currentPage?.revision?._id,
    fetchCurrentPageYjsData,
    isNotFound,
    pageId,
  ]);
};

export const useNewlyYjsDataSyncingEffect = (): void => {
  const socket = useGlobalSocket();
  const { updateHasYdocsNewerThanLatestRevision } =
    useCurrentPageYjsDataActions();

  useEffect(() => {
    if (socket == null) {
      // socket must be null if the user is a guest
      return;
    }

    socket.on(
      SocketEventName.YjsHasYdocsNewerThanLatestRevisionUpdated,
      updateHasYdocsNewerThanLatestRevision,
    );

    return () => {
      socket.off(
        SocketEventName.YjsHasYdocsNewerThanLatestRevisionUpdated,
        updateHasYdocsNewerThanLatestRevision,
      );
    };
  }, [socket, updateHasYdocsNewerThanLatestRevision]);
};

export const useAwarenessSyncingEffect = (): void => {
  const socket = useGlobalSocket();
  const { updateAwarenessStateSize } = useCurrentPageYjsDataActions();

  useEffect(() => {
    if (socket == null) {
      // socket must be null if the user is a guest
      return;
    }

    socket.on(
      SocketEventName.YjsAwarenessStateSizeUpdated,
      updateAwarenessStateSize,
    );

    return () => {
      socket.off(
        SocketEventName.YjsAwarenessStateSizeUpdated,
        updateAwarenessStateSize,
      );
    };
  }, [socket, updateAwarenessStateSize]);
};
