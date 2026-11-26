import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { mock } from 'vitest-mock-extended';

import type { AttachmentWithComputed } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { AttachmentTextExtractorService } from './attachment-text-extractor';

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port),
    );
  });

const successBody = (content: string): string =>
  JSON.stringify({
    pages: [{ pageNumber: null, label: null, content }],
    mimeType: 'text/plain',
  });

// The real generated client against a local stand-in for the extractor.
describe('AttachmentTextExtractorService limits on the extractor answer', () => {
  const servers: http.Server[] = [];

  const startExtractor = async (
    handler: http.RequestListener,
    { timeoutMs }: { timeoutMs: number },
  ): Promise<void> => {
    const server = http.createServer(handler);
    servers.push(server);
    const port = await listen(server);

    vi.spyOn(configManager, 'getConfig').mockImplementation(((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return `http://127.0.0.1:${port}`;
      if (key === 'app:attachmentFullTextSearch:extractorToken') return 'tok';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return timeoutMs;
      if (key === 'app:attachmentFullTextSearch:maxFileSizeBytes') return 1024;
      return undefined;
    }) as typeof configManager.getConfig);
  };

  const createService = (
    options?: ConstructorParameters<typeof AttachmentTextExtractorService>[1],
  ) =>
    new AttachmentTextExtractorService(
      { findDeliveryFile: async () => Readable.from(Buffer.from('data')) },
      options,
    );

  beforeEach(() => {
    vi.spyOn(prisma.attachments, 'findUnique').mockResolvedValue(
      mock<AttachmentWithComputed>({
        id: 'a1',
        _id: 'a1',
        fileFormat: 'text/plain',
        fileSize: 4,
        fileName: 'a1.txt',
        originalName: 'a1.txt',
      }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise((r) => {
            s.closeAllConnections();
            s.close(r);
          }),
      ),
    );
  });

  describe('the size of the answer', () => {
    it('reports an answer above the limit as a resource limit of that file', async () => {
      await startExtractor(
        (req, res) => {
          req.resume();
          res.setHeader('Content-Type', 'application/json');
          res.end(successBody('x'.repeat(4096)));
        },
        { timeoutMs: 5000 },
      );

      const outcome = await createService({
        maxResponseBytes: 1024,
      }).extractAttachment('a1');

      expect(outcome).toEqual({
        kind: 'resourceLimit',
        message: expect.any(String),
      });
    });

    it('accepts an answer within the limit', async () => {
      await startExtractor(
        (req, res) => {
          req.resume();
          res.setHeader('Content-Type', 'application/json');
          res.end(successBody('short'));
        },
        { timeoutMs: 5000 },
      );

      const outcome = await createService({
        maxResponseBytes: 1024,
      }).extractAttachment('a1');

      expect(outcome).toEqual({
        kind: 'success',
        pages: [{ pageNumber: null, label: null, content: 'short' }],
        mimeType: 'text/plain',
      });
    });
  });

  describe('the time of one whole call', () => {
    it('gives up on an answer that keeps arriving a little at a time, and closes the connection', async () => {
      let connectionClosed = false;
      await startExtractor(
        (req, res) => {
          req.resume();
          res.setHeader('Content-Type', 'application/json');
          res.write('{"pages":[');
          // Each chunk arrives well within timeoutMs, so only a limit on the whole call ends it
          const trickle = setInterval(() => res.write(' '), 50);
          res.on('close', () => {
            clearInterval(trickle);
            connectionClosed = true;
          });
        },
        { timeoutMs: 300 },
      );

      const started = performance.now();
      const outcome = await createService().extractAttachment('a1');
      const elapsedMs = performance.now() - started;

      expect(outcome).toEqual({ kind: 'serviceUnreachable' });
      expect(elapsedMs).toBeGreaterThanOrEqual(250);
      expect(elapsedMs).toBeLessThan(2000);
      await vi.waitFor(() => expect(connectionClosed).toBe(true));
    });
  });
});
