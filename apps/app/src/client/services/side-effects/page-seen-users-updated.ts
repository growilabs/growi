import { useCallback, useEffect } from 'react';

import { SocketEventName } from '~/interfaces/websocket';
import { useCurrentPageId } from '~/states/page';
import { useGlobalSocket } from '~/states/socket-io';
import { useSWRxPageInfo } from '~/stores/page';

export const usePageSeenUsersUpdatedEffect = (): void => {
  const socket = useGlobalSocket();
  const currentPageId = useCurrentPageId();
  const { mutate: mutatePageInfo } = useSWRxPageInfo(currentPageId);

  const seenUsersUpdatedHandler = useCallback(
    (data: { pageId: string }) => {
      if (currentPageId != null && currentPageId === data.pageId) {
        mutatePageInfo();
      }
    },
    [currentPageId, mutatePageInfo],
  );

  useEffect(() => {
    if (socket == null) {
      return;
    }

    socket.on(SocketEventName.PageSeenUsersUpdated, seenUsersUpdatedHandler);

    return () => {
      socket.off(SocketEventName.PageSeenUsersUpdated, seenUsersUpdatedHandler);
    };
  }, [seenUsersUpdatedHandler, socket]);
};
