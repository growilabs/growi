// Test fixture, not production surface (excluded from `tsconfig.build.json`,
// like `capabilities/test-channels.ts`): a chat service's HTTP API on loopback,
// for driving a real adapter without reaching the service, and the sink that
// catches what that adapter's events become.
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import type { PlatformEvent, PlatformEventSink } from '../types/index.js';

export interface ReceivedRequest {
  readonly method: string;
  /** Path and query, as the adapter sent them. */
  readonly path: string;
  readonly authorization: string | undefined;
  /** JSON, or a form body as an object; `null` when there was none. */
  readonly body: unknown;
}

export interface StandInReply {
  readonly status?: number;
  /** Sent as JSON; no body at all when absent. */
  readonly body?: unknown;
}

export type StandInResponder = (request: ReceivedRequest) => StandInReply;

export interface ChatServiceStandIn {
  readonly url: string;
  readonly requests: ReceivedRequest[];
  /** Pushes one WebSocket text frame to every client that has authenticated. */
  push(payload: unknown): void;
  close(): Promise<void>;
}

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODE_CLOSE = 0x8;

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') return null;
  if (request.headers['content-type']?.includes('json')) return JSON.parse(raw);
  return Object.fromEntries(new URLSearchParams(raw));
};

const textFrame = (payload: unknown): Buffer => {
  const data = Buffer.from(JSON.stringify(payload));
  const header =
    data.length < 126
      ? Buffer.from([0x81, data.length])
      : Buffer.from([0x81, 126, data.length >> 8, data.length & 0xff]);
  return Buffer.concat([header, data]);
};

/** A client's frames are always masked (RFC 6455 5.3). */
const readFrames = (
  chunk: Buffer,
): Array<{ readonly opcode: number; readonly text: string }> => {
  const frames: Array<{ opcode: number; text: string }> = [];
  let offset = 0;
  while (offset + 2 <= chunk.length) {
    const opcode = (chunk[offset] ?? 0) & 0x0f;
    let length = (chunk[offset + 1] ?? 0) & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      length = chunk.readUInt16BE(cursor);
      cursor += 2;
    }
    const mask = chunk.subarray(cursor, cursor + 4);
    cursor += 4;
    const masked = chunk.subarray(cursor, cursor + length);
    const text = Buffer.from(
      masked.map((byte, i) => byte ^ (mask[i % 4] ?? 0)),
    ).toString('utf8');
    frames.push({ opcode, text });
    offset = cursor + length;
  }
  return frames;
};

/**
 * Answers every HTTP request with `responder` and records it. A WebSocket
 * upgrade is accepted, and Mattermost's `authentication_challenge` answered
 * with `OK` -- all its adapter waits for before it counts as connected.
 */
export const startChatServiceStandIn = async (
  responder: StandInResponder,
): Promise<ChatServiceStandIn> => {
  const requests: ReceivedRequest[] = [];
  const sockets: Socket[] = [];
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const received: ReceivedRequest = {
        method: request.method ?? '',
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body: await readBody(request),
      };
      requests.push(received);
      const reply = responder(received);
      response.statusCode = reply.status ?? 200;
      if (reply.body === undefined) {
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(reply.body));
    },
  );
  server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}${WEBSOCKET_GUID}`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      for (const frame of readFrames(chunk)) {
        if (frame.opcode === OPCODE_CLOSE) {
          socket.end(Buffer.from([0x80 | OPCODE_CLOSE, 0]));
          return;
        }
        const message = JSON.parse(frame.text) as {
          readonly seq?: number;
          readonly action?: string;
        };
        if (message.action === 'authentication_challenge') {
          sockets.push(socket);
          socket.write(textFrame({ status: 'OK', seq_reply: message.seq }));
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    push: (payload) => {
      for (const socket of sockets) socket.write(textFrame(payload));
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

export interface CaughtEvents {
  readonly sink: PlatformEventSink;
  /**
   * The next event the sink is handed. Adapters dispatch without awaiting the
   * handler, so a test waits here rather than right after delivering.
   */
  next(): Promise<PlatformEvent>;
}

export const catchEvents = (timeoutMs = 5_000): CaughtEvents => {
  const pending: PlatformEvent[] = [];
  const waiting: Array<(event: PlatformEvent) => void> = [];
  return {
    sink: {
      handle: (event) => {
        const waiter = waiting.shift();
        if (waiter == null) pending.push(event);
        else waiter(event);
        return Promise.resolve();
      },
    },
    next: () => {
      const ready = pending.shift();
      if (ready != null) return Promise.resolve(ready);
      return new Promise<PlatformEvent>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no event arrived within ${timeoutMs} ms`)),
          timeoutMs,
        );
        waiting.push((event) => {
          clearTimeout(timer);
          resolve(event);
        });
      });
    },
  };
};
