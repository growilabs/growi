import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { docs, setPersistence, setupWSConnection } from 'y-websocket/bin/utils';

import { guardSocket } from './guard-socket';

/**
 * Creates a test server where:
 * 1. The Yjs upgrade handler guards the socket and awaits before completing
 * 2. A hostile handler (simulating Next.js) calls socket.end() for /yjs/ paths
 */
const createServerWithHostileHandler = (): {
  server: http.Server;
  wss: WebSocketServer;
} => {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });

  // Yjs handler (registered first — same order as production)
  server.on('upgrade', async (request, socket, head) => {
    const url = request.url ?? '';
    if (!url.startsWith('/yjs/')) return;

    const pageId = url.slice('/yjs/'.length).split('?')[0];

    const guard = guardSocket(socket);

    try {
      // Simulate async auth delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      guard.restore();

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
        setupWSConnection(ws, request, { docName: pageId });
      });
    } catch {
      guard.restore();
      socket.destroy();
    }
  });

  // Hostile handler (registered second — simulates Next.js upgradeHandler)
  server.on('upgrade', (_request, socket) => {
    socket.end();
  });

  return { server, wss };
};

const connectClient = (port: number, pageId: string): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/yjs/${pageId}`);
    ws.binaryType = 'arraybuffer';
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
};

describe('guardSocket — protection against hostile upgrade handlers', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;

  beforeAll(async () => {
    setPersistence(null);

    const testServer = createServerWithHostileHandler();
    server = testServer.server;
    wss = testServer.wss;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const [name, doc] of docs) {
      doc.destroy();
      docs.delete(name);
    }

    await new Promise<void>((resolve) => {
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  });

  afterEach(() => {
    for (const [name, doc] of docs) {
      doc.destroy();
      docs.delete(name);
    }
  });

  it('should establish WebSocket connection even when a hostile handler calls socket.end()', async () => {
    const pageId = 'guard-test-001';

    const ws = await connectClient(port, pageId);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const serverDoc = docs.get(pageId);
    expect(serverDoc).toBeDefined();
    assert(serverDoc !== undefined);
    expect(serverDoc.conns.size).toBe(1);

    ws.close();
  });

  it('should handle multiple concurrent connections with hostile handler', async () => {
    const pageId = 'guard-test-002';

    const connections = await Promise.all([
      connectClient(port, pageId),
      connectClient(port, pageId),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const serverDoc = docs.get(pageId);
    expect(serverDoc).toBeDefined();
    assert(serverDoc !== undefined);
    expect(serverDoc.conns.size).toBe(2);

    for (const ws of connections) {
      ws.close();
    }
  });

  it('should allow normal close after guard is restored', async () => {
    const pageId = 'guard-test-003';

    const ws = await connectClient(port, pageId);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Connection succeeds, meaning socket.end/destroy were properly
    // guarded during async auth and restored before wss.handleUpgrade
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After close, the server doc should have removed the connection
    const serverDoc = docs.get(pageId);
    if (serverDoc) {
      expect(serverDoc.conns.size).toBe(0);
    }
  });
});
