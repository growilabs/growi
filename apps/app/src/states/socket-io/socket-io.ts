import { GLOBAL_SOCKET_NS } from '@growi/core/dist/swr';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';

import { SocketEventName } from '~/interfaces/websocket';
import { useCurrentPageId } from '~/states/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:states:websocket');

// WebSocket connection atom
const globalSocketAtom = atom<Socket | null>(null);

/**
 * Hook to get WebSocket connection
 */
export const useGlobalSocket = (): Socket | null => useAtomValue(globalSocketAtom);

/**
 * Hook to initialize WebSocket connection
 * Alternative to useSetupGlobalSocket
 */
export const useSetupGlobalSocket = (): void => {
  const setSocket = useSetAtom(globalSocketAtom);
  const socket = useAtomValue(globalSocketAtom);

  const initializeSocket = useCallback(async () => {
    try {
      // Dynamic import of socket.io-client
      const { io } = await import('socket.io-client');
      const newSocket = io(GLOBAL_SOCKET_NS, {
        transports: ['websocket'],
      });

      // Error handling
      newSocket.on('error', (err) => {
        logger.error(err);
      });
      newSocket.on('connect_error', (err) => {
        logger.error('Failed to connect with websocket.', err);
      });

      // Store connection in atom
      setSocket(newSocket);
    } catch (error) {
      logger.error('Failed to initialize WebSocket:', error);
    }
  }, [setSocket]);

  useEffect(() => {
    if (socket == null) {
      initializeSocket();
    }
  }, [socket, initializeSocket]);
};

/**
 * Hook for page-specific WebSocket room management
 * Alternative to useSetupGlobalSocketForPage
 */
export const useSetupGlobalSocketForPage = (): void => {
  const socket = useAtomValue(globalSocketAtom);
  const pageId = useCurrentPageId();

  useEffect(() => {
    if (socket == null || pageId == null) {
      return;
    }

    socket.emit(SocketEventName.JoinPage, { pageId });

    return () => {
      socket.emit(SocketEventName.LeavePage, { pageId });
    };
  }, [pageId, socket]);
};
