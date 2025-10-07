import { useCallback, useEffect } from 'react';

import { atom, useAtomValue, useSetAtom } from 'jotai';
import type { Socket } from 'socket.io-client';

// Constants
export const PLAYGROUND_SOCKET_NS = '/';

// WebSocket connection atom for playground
const playgroundSocketAtom = atom<Socket | null>(null);

/**
 * Hook to get WebSocket connection for playground
 */
export const usePlaygroundSocket = (): Socket | null => useAtomValue(playgroundSocketAtom);

/**
 * Hook to initialize WebSocket connection for playground
 */
export const useSetupPlaygroundSocket = (): void => {
  const setSocket = useSetAtom(playgroundSocketAtom);
  const socket = useAtomValue(playgroundSocketAtom);

  const initializeSocket = useCallback(async() => {
    try {
      // Dynamic import of socket.io-client
      const { io } = await import('socket.io-client');
      const newSocket = io(PLAYGROUND_SOCKET_NS, {
        transports: ['websocket'],
      });

      // Error handling
      newSocket.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error(err);
      });
      newSocket.on('connect_error', (err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to connect with websocket.', err);
      });

      // Store connection in atom
      setSocket(newSocket);
    }
    catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to initialize WebSocket:', error);
    }
  }, [setSocket]);

  useEffect(() => {
    if (socket == null) {
      initializeSocket();
    }
  }, [socket, initializeSocket]);
};
