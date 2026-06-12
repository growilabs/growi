import { useCallback, useEffect } from 'react';

import { SocketEventName } from '~/interfaces/websocket.js';
import { useCurrentPageId } from '~/states/page/index.js';
import { useGlobalSocket } from '~/states/socket-io/index.js';
import { useSWRxPageInfo } from '~/stores/page.js';

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
