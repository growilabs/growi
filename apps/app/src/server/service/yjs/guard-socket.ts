import type { Duplex } from 'node:stream';

type SocketGuard = {
  restore: () => void;
};

/**
 * Temporarily replaces socket.end() and socket.destroy() with no-ops.
 *
 * This prevents other synchronous `upgrade` event listeners (e.g. Next.js's
 * NextCustomServer.upgradeHandler) from closing the socket while an async
 * handler is awaiting authentication.
 *
 * Call `restore()` on the returned object to reinstate the original methods
 * before performing the actual WebSocket handshake or cleanup.
 */
export const guardSocket = (socket: Duplex): SocketGuard => {
  const origEnd = socket.end.bind(socket);
  const origDestroy = socket.destroy.bind(socket);

  socket.end = () => socket;
  socket.destroy = () => socket;

  return {
    restore: () => {
      socket.end = origEnd;
      socket.destroy = origDestroy;
    },
  };
};
