import type { Socket } from 'socket.io-client';
import io from 'socket.io-client';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:cli:stores:socket-io');

const socketFactory = (namespace: string): Socket => {
  const socket = io(namespace, {
    transports: ['websocket'],
  });

  socket.on('connect_error', (error) => {
    logger.error(namespace, error);
  });
  socket.on('error', (error) => {
    logger.error(namespace, error);
  });

  return socket;
};

const useSocket = (namespace: string): SWRResponse<Socket, Error> => {
  const swrResponse = useSWRImmutable(namespace, null);

  if (swrResponse.data === undefined) {
    swrResponse.mutate(socketFactory(namespace));
  }

  return swrResponse;
};

export const useDefaultSocket = (): SWRResponse<Socket, Error> => {
  return useSocket('/');
};

export const useAdminSocket = (): SWRResponse<Socket, Error> => {
  return useSocket('/admin');
};
