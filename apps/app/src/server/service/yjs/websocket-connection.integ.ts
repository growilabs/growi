import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { docs, setPersistence, setupWSConnection } from 'y-websocket/bin/utils';

/**
 * Creates a minimal HTTP + y-websocket server for testing.
 * No authentication — pure document sync testing.
 */
const createTestServer = (): { server: http.Server; wss: WebSocketServer } => {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (!url.startsWith('/yjs/')) return;
    const pageId = url.slice('/yjs/'.length).split('?')[0];

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
      setupWSConnection(ws, request, { docName: pageId });
    });
  });

  return { server, wss };
};

/**
 * Connects a WebSocket client and waits for the connection to open.
 */
const connectClient = (port: number, pageId: string): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/yjs/${pageId}`);
    ws.binaryType = 'arraybuffer';
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
};

/**
 * Waits for a WebSocket to fully close.
 */
const waitForClose = (ws: WebSocket): Promise<void> => {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on('close', () => resolve());
  });
};

describe('WebSocket Connection and Sync Flow', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;

  beforeAll(async () => {
    setPersistence(null);

    const testServer = createTestServer();
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

  describe('Task 8.1: Connection and sync flow', () => {
    it('should create a server-side Y.Doc on first client connection', async () => {
      const pageId = 'test-page-sync-001';

      const ws = await connectClient(port, pageId);

      // Wait for setupWSConnection to register the doc
      await new Promise((resolve) => setTimeout(resolve, 50));

      const serverDoc = docs.get(pageId);
      expect(serverDoc).toBeDefined();
      expect(serverDoc!.name).toBe(pageId);
      expect(serverDoc!.conns.size).toBe(1);

      ws.close();
    });

    it('should register multiple clients on the same server-side Y.Doc', async () => {
      const pageId = 'test-page-multi-001';

      const ws1 = await connectClient(port, pageId);
      const ws2 = await connectClient(port, pageId);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const serverDoc = docs.get(pageId);
      expect(serverDoc).toBeDefined();
      expect(serverDoc!.conns.size).toBe(2);

      ws1.close();
      ws2.close();
    });

    it('should keep the server doc alive when one client disconnects', async () => {
      const pageId = 'test-page-reconnect-001';

      const ws1 = await connectClient(port, pageId);
      const ws2 = await connectClient(port, pageId);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Disconnect client 1
      ws1.close();
      await waitForClose(ws1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Server doc should still exist with client 2
      const serverDoc = docs.get(pageId);
      expect(serverDoc).toBeDefined();
      expect(serverDoc!.conns.size).toBe(1);

      ws2.close();
    });
  });

  describe('Task 8.2: Concurrency - single Y.Doc per page', () => {
    it('should create exactly one Y.Doc for simultaneous connections', async () => {
      const pageId = 'test-page-concurrent-001';

      // Connect multiple clients simultaneously
      const connections = await Promise.all([
        connectClient(port, pageId),
        connectClient(port, pageId),
        connectClient(port, pageId),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify single Y.Doc instance
      const serverDoc = docs.get(pageId);
      expect(serverDoc).toBeDefined();
      expect(serverDoc!.conns.size).toBe(3);

      // Only one doc for this page
      const matchingDocs = Array.from(docs.values()).filter(
        (d) => d.name === pageId,
      );
      expect(matchingDocs).toHaveLength(1);

      for (const ws of connections) {
        ws.close();
      }
    });

    it('should handle disconnect during connect without document corruption', async () => {
      const pageId = 'test-page-disconnect-001';

      // Client 1 connects
      const ws1 = await connectClient(port, pageId);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Write to server doc directly
      const serverDoc = docs.get(pageId);
      expect(serverDoc).toBeDefined();
      serverDoc!.getText('codemirror').insert(0, 'Hello World');

      // Client 2 connects and immediately disconnects
      const ws2 = await connectClient(port, pageId);
      ws2.close();
      await waitForClose(ws2);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Server doc should still exist with client 1
      const docAfter = docs.get(pageId);
      expect(docAfter).toBeDefined();
      expect(docAfter!.conns.size).toBe(1);

      // Text should be intact
      expect(docAfter!.getText('codemirror').toString()).toBe('Hello World');

      ws1.close();
    });
  });
});
