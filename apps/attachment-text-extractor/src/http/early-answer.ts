import type { IncomingMessage } from 'node:http';

import type { ErrorCode } from '../contract';
import type { AppContext } from './app-env';

// The most the drain reads of a body nobody wants, and how long it waits for
// one that was never read at all (the bound @hono/node-server's own drain has).
const DRAIN_MAX_BYTES = 64 * 1024 * 1024;
const DRAIN_WAIT_MS = 500;

// Node and @hono/node-server may both call destroySoon for one socket.
const draining = new WeakSet<object>();

// Read and drop what is left of the request body, then let Node close the
// socket its usual way (destroySoon: end our side, destroy once written).
// Ending with socket.end() alone would keep the socket of a client that never
// sends FIN open for good (research.md 16.9, 16.10).
const drainThenClose = (
  incoming: IncomingMessage,
  destroySoon: () => void,
): void => {
  const socket = incoming.socket;
  if (draining.has(socket)) return;
  draining.add(socket);
  if (incoming.complete) {
    destroySoon.call(socket);
    return;
  }
  let read = 0;
  const giveUp = setTimeout(() => socket.destroy(), DRAIN_WAIT_MS);
  incoming.on('data', (data: Buffer) => {
    read += data.length;
    if (read > DRAIN_MAX_BYTES) {
      clearTimeout(giveUp);
      socket.destroy();
    }
  });
  incoming.once('end', () => {
    clearTimeout(giveUp);
    destroySoon.call(socket);
  });
  incoming.resume();
};

/**
 * An error answer given before (or instead of) reading the whole body.
 * When Node will close the connection after it (HTTP/1.0 without keep-alive,
 * `Connection: close`), closing with unread input resets the connection and
 * the client can lose the answer; so the unread body is drained first. This
 * leans on Node's undocumented path (shouldKeepAlive, destroySoon); the
 * early-answer tests repeat it to catch a change (research.md 16.5).
 */
export const errorAnswer = (
  c: AppContext,
  status: number,
  code: ErrorCode,
  message: string,
): Response => {
  const { incoming, outgoing } = c.env;
  if (outgoing.shouldKeepAlive === false) {
    const socket = incoming.socket;
    const destroySoon = socket.destroySoon;
    socket.destroySoon = () => drainThenClose(incoming, destroySoon);
  }
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
};
