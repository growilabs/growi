import { useEffect } from 'react';

import { useGlobalSocket, GLOBAL_SOCKET_KEY, GLOBAL_SOCKET_NS } from '@growi/core/dist/swr';
import type { Socket } from 'socket.io-client';
import type { SWRResponse } from 'swr';

import { SocketEventName } from '~/interfaces/websocket';
import loggerFactory from '~/utils/logger';

import { useStaticSWR } from './use-static-swr';

const logger = loggerFactory('growi:stores:ui');

export const GLOBAL_ADMIN_SOCKET_NS = '/admin';
export const GLOBAL_ADMIN_SOCKET_KEY = 'globalAdminSocket';

/*
 * Global Socket
 */
export const useSetupGlobalSocket = (): void => {

  const { mutate } = useStaticSWR(GLOBAL_SOCKET_KEY);

  useEffect(() => {
    const setUpSocket = async() => {
      const { io } = await import('socket.io-client');
      const socket = io(GLOBAL_SOCKET_NS, {
        transports: ['websocket'],
      });

      socket.on('error', (err) => { logger.error(err) });
      socket.on('connect_error', (err) => { logger.error('Failed to connect with websocket.', err) });

      mutate(socket);
    };

    setUpSocket();

  }, [mutate]);
};

// comment out for porduction build error: https://github.com/weseek/growi/pull/7131
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
  return useStaticSWR(GLOBAL_ADMIN_SOCKET_KEY);
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
