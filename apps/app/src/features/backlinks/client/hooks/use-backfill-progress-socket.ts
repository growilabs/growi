import { useEffect } from 'react';
import type { KeyedMutator } from 'swr';

import { useAdminSocket } from '~/features/admin/states/socket-io';
import { SocketEventName } from '~/interfaces/websocket';

import type {
  BacklinksBackfillProgressData,
  BacklinksBackfillState,
} from '../../interfaces/page-link-backfill';

/**
 * Folds each progress event into the cached job state at once, then reads the state again: the
 * event carries no coverage, completion time or stop flag.
 */
export const useBackfillProgressSocket = (
  mutate: KeyedMutator<BacklinksBackfillState>,
): void => {
  const socket = useAdminSocket();

  useEffect(() => {
    if (socket == null) return;

    const onProgress = (data: BacklinksBackfillProgressData) => {
      void mutate(
        (current) =>
          current == null
            ? current
            : {
                ...current,
                status: data.status,
                processed: data.processed,
                runTotal: data.runTotal,
                skippedPages: data.skippedPages,
              },
        { revalidate: true },
      );
    };

    socket.on(SocketEventName.BacklinksBackfillProgress, onProgress);
    return () => {
      socket.off(SocketEventName.BacklinksBackfillProgress, onProgress);
    };
  }, [socket, mutate]);
};
