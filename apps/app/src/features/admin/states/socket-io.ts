import { useEffect } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import type { Socket } from 'socket.io-client';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:cli:states:socket');

// Socket.IO client is imported dynamically so that socket.io-client stays out
// of the SSR bundle (.next/node_modules/) and can be listed in devDependencies.
const adminSocketAtom = atom<Socket | null>(null);

/**
 * Hook to initialise the admin Socket.IO connection.
 * Call this once from AdminLayout so every admin page shares the connection.
 */
export const useSetupAdminSocket = (): void => {
  const setSocket = useSetAtom(adminSocketAtom);
  const socket = useAtomValue(adminSocketAtom);

  useEffect(() => {
    if (socket != null) return;

    let cancelled = false;

    import('socket.io-client')
      .then(({ default: io }) => {
        if (cancelled) return;
        const newSocket = io('/admin', { transports: ['websocket'] });
        newSocket.on('connect_error', (error) => logger.error('/admin', error));
        newSocket.on('error', (error) => logger.error('/admin', error));
        setSocket(newSocket);
      })
      .catch((error) =>
        logger.error('Failed to initialize admin WebSocket:', error),
      );

    return () => {
      cancelled = true;
    };
  }, [socket, setSocket]);
};

/** Returns the admin Socket.IO instance, or null before it is initialised. */
export const useAdminSocket = (): Socket | null => {
  return useAtomValue(adminSocketAtom);
};
