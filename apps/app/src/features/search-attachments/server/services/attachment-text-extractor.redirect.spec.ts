import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('AttachmentTextExtractorService redirect handling', () => {
  const servers: http.Server[] = [];

  beforeEach(() => {
    vi.spyOn(prisma.attachments, 'findUnique').mockResolvedValue(
      mock<AttachmentWithComputed>({
        id: 'a1',
        _id: 'a1',
        fileFormat: 'application/pdf',
        fileSize: 4,
      }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map((s) => new Promise((r) => s.close(r))),
    );
  });

  it('does not follow a redirect and fails closed as serviceUnreachable', async () => {
    const target = vi.fn();
    const targetServer = http.createServer((_req, res) => {
      target();
      res.statusCode = 200;
      res.end('{}');
    });
    servers.push(targetServer);
    const targetPort = await listen(targetServer);

    const extractorServer = http.createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', `http://127.0.0.1:${targetPort}/latest`);
      res.end();
    });
    servers.push(extractorServer);
    const extractorPort = await listen(extractorServer);

    vi.spyOn(configManager, 'getConfig').mockImplementation(((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return `http://127.0.0.1:${extractorPort}`;
      if (key === 'app:attachmentFullTextSearch:extractorToken') return 'tok';
      if (key === 'app:attachmentFullTextSearch:timeoutMs') return 5000;
      return undefined;
    }) as typeof configManager.getConfig);

    const service = new AttachmentTextExtractorService({
      findDeliveryFile: async () => Readable.from(Buffer.from('data')),
    });

    const outcome = await service.extractAttachment('a1');

    expect(outcome).toEqual({ kind: 'serviceUnreachable' });
    expect(target).not.toHaveBeenCalled();
  });
});
