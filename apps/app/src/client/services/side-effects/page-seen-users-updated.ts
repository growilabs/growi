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
    (data: {
      s2cMessagePageSeenUsersUpdated: {
        pageId: string;
        seenUserIds: string[];
        seenUsersCount: number;
      };
    }) => {
      const { s2cMessagePageSeenUsersUpdated } = data;

      if (
        currentPageId != null &&
        currentPageId === s2cMessagePageSeenUsersUpdated.pageId
      ) {
        mutatePageInfo(
          (currentData) => {
            if (currentData == null) return currentData;
            return {
              ...currentData,
              seenUserIds: s2cMessagePageSeenUsersUpdated.seenUserIds,
              sumOfSeenUsers: s2cMessagePageSeenUsersUpdated.seenUsersCount,
            };
          },
          { revalidate: false },
        );
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
