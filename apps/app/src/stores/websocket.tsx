import { useEffect } from 'react';

import {
  useGlobalSocket, GLOBAL_SOCKET_NS, useSWRStatic,
} from '@growi/core/dist/swr';
import type { Socket } from 'socket.io-client';
import type { SWRResponse } from 'swr';

import { SocketEventName } from '~/interfaces/websocket';
import { useIsGuestUser } from '~/stores-universal/context';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:stores:ui');

export const GLOBAL_ADMIN_SOCKET_NS = '/admin';
export const GLOBAL_ADMIN_SOCKET_KEY = 'globalAdminSocket';

/*
 * Global Socket
 */
export const useSetupGlobalSocket = (): void => {

  const { data: socket, mutate } = useGlobalSocket();
  const { data: isGuestUser } = useIsGuestUser();

  useEffect(() => {
    // Skip Socket.IO connection for guest users (not logged in)
    // Guest users don't need real-time updates as they can only read pages
    if (isGuestUser) {
      logger.debug('Socket.IO connection skipped for guest user');
      return;
    }

    if (socket != null) {
      return;
    }

    mutate(async() => {
      const { io } = await import('socket.io-client');
      const newSocket = io(GLOBAL_SOCKET_NS, {
        transports: ['websocket'],
      });

      newSocket.on('error', (err) => { logger.error(err) });
      newSocket.on('connect_error', (err) => { logger.error('Failed to connect with websocket.', err) });

      return newSocket;
    });

    // Cleanup function to disconnect socket when component unmounts or user logs out
    return () => {
      if (socket != null && typeof socket === 'object' && 'disconnect' in socket) {
        logger.debug('Disconnecting Socket.IO connection');
        (socket as Socket).disconnect();
        mutate(undefined, false); // Clear the SWR cache without revalidation
      }
    };
  }, [socket, isGuestUser, mutate]);
};

// comment out for porduction build error: https://github.com/growilabs/growi/pull/7131
/*
 * Global Admin Socket
 */
// export const useSetupGlobalAdminSocket = (shouldInit: boolean): SWRResponse<Socket, Error> => {
//   let socket: Socket | undefined;

//   if (shouldInit) {
//     socket = io(GLOBAL_ADMIN_SOCKET_NS, {
//       transports: ['websocket'],
//     });

//     socket.on('error', (err) => { logger.error(err) });
//     socket.on('connect_error', (err) => { logger.error('Failed to connect with websocket.', err) });
//   }

//   return useStaticSWR(shouldInit ? GLOBAL_ADMIN_SOCKET_KEY : null, socket);
// };

export const useGlobalAdminSocket = (): SWRResponse<Socket, Error> => {
  return useSWRStatic(GLOBAL_ADMIN_SOCKET_KEY);
};

export const useSetupGlobalSocketForPage = (pageId: string | undefined): void => {
  const { data: socket } = useGlobalSocket();

  useEffect(() => {
    if (socket == null || pageId == null) { return }

    socket.emit(SocketEventName.JoinPage, { pageId });

    return () => {
      socket.emit(SocketEventName.LeavePage, { pageId });
    };
  }, [pageId, socket]);
};
