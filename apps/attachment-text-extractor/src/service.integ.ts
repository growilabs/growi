import { randomBytes } from 'node:crypto';

import {
  errorOf,
  extractedOf,
  getPath,
  postFile,
} from './http/spec-support/extract-client';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from './http/spec-support/multipart';
import { openConnection, requestHead } from './http/spec-support/raw-http';
import { killStrayChildren } from './runner/spec-support';
import { type RunningService, startService } from './service';

// The composition root (design.md judgement 5): settings -> runner -> app ->
// listener, from the environment alone. Req 1.4 / 1.5: no token, no service.
// Stopping drains like uvicorn on SIGTERM: no new connections, the requests
// in flight still get their answers (the k8s example gives them 85 s).

const TOKEN_NAME = 'ATTACHMENT_EXTRACTOR_SERVICE_TOKEN';
const LOCAL = { port: 0, hostname: '127.0.0.1' } as const;

const quiet = { writeLog: () => {} };

describe('startService', () => {
  it.each([
    ['unset', {}],
    ['blank', { [TOKEN_NAME]: '  \t' }],
  ])('refuses to start when the token is %s', async (_, env) => {
    await expect(startService(env, LOCAL, quiet)).rejects.toThrow(TOKEN_NAME);
  });
});

describe.skipIf(process.platform !== 'linux')(
  'a started service',
  { timeout: 30_000 },
  () => {
    const token = `service-${randomBytes(8).toString('hex')}`;
    let service: RunningService | undefined;
    const url = () => `http://127.0.0.1:${service?.port}`;

    afterEach(async () => {
      await service?.stop();
      service = undefined;
      await killStrayChildren();
    });

    it('converts in a real child, with the settings given to the HTTP layer and the runner', async () => {
      service = await startService(
        { [TOKEN_NAME]: token, MAX_FILE_SIZE_MB: '1', MAX_CSV_BYTES: '4' },
        LOCAL,
        quiet,
      );

      const text = await postFile(url(), 'a.txt', 'hello', { token });
      const tooLarge = await postFile(
        url(),
        'a.txt',
        Buffer.alloc(1024 * 1024 + 1, 0x78),
        { token },
      );
      const csv = await postFile(url(), 'a.csv', 'a,b\n1,2\n', { token });

      expect(extractedOf(text).pages.map((page) => page.content)).toEqual([
        'hello',
      ]);
      expect(tooLarge.status).toBe(413);
      expect(errorOf(tooLarge).message).toContain('1 MiB');
      expect(csv.status).toBe(422);
      expect(errorOf(csv).code).toBe('resource_limit_exceeded');
      expect((await getPath(url(), '/readyz')).status).toBe(200);
    });

    it('stop() answers the request in flight, then refuses new connections', async () => {
      service = await startService({ [TOKEN_NAME]: token }, LOCAL, quiet);
      const address = { host: '127.0.0.1', port: service.port };
      const file = fileHead('a.txt');
      const tail = bodyTail();
      const content = Buffer.from('in flight');
      const connection = await openConnection(address);
      await connection.send(
        requestHead({
          token,
          contentType: multipartContentType(),
          contentLength: file.length + content.length + tail.length,
          extra: ['Expect: 100-continue'],
        }),
      );
      // The 100 comes once the route has taken a slot and reads the body.
      await vi.waitFor(() => expect(connection.interim()).toEqual([100]));

      let stopped = false;
      const stopping = service.stop().then(() => {
        stopped = true;
      });
      service = undefined;

      await expect(openConnection(address)).rejects.toThrow(/ECONNREFUSED/);
      expect(stopped).toBe(false);
      await connection.send(Buffer.concat([file, content, tail]));
      const answer = await connection.response(10_000);
      const answered = performance.now();
      await stopping;

      expect(answer?.status).toBe(200);
      expect(answer?.text).toContain('in flight');
      // Its connection is keep-alive: stopping must not wait out the idle timeout.
      expect(performance.now() - answered).toBeLessThan(1_000);
      connection.destroy();
    });

    it('stop() does not wait for an idle keep-alive connection', async () => {
      service = await startService({ [TOKEN_NAME]: token }, LOCAL, quiet);
      const connection = await openConnection({
        host: '127.0.0.1',
        port: service.port,
      });
      await connection.send(requestHead({ method: 'GET', path: '/healthz' }));
      expect((await connection.response(5_000))?.status).toBe(200);

      const started = performance.now();
      await service.stop();
      service = undefined;

      expect(performance.now() - started).toBeLessThan(1_000);
      connection.destroy();
    });

    // No token is needed to open such a connection, and Node never counts it
    // as idle: left alone it would keep a stopping service alive.
    it('stop() does not wait for a connection that has sent only part of its headers', async () => {
      service = await startService({ [TOKEN_NAME]: token }, LOCAL, quiet);
      const connection = await openConnection({
        host: '127.0.0.1',
        port: service.port,
      });
      await connection.send(
        Buffer.from('GET /healthz HTTP/1.1\r\nHost: x\r\n'),
      );
      const stopping = service.stop().then(() => 'stopped');
      service = undefined;

      const outcome = await Promise.race([
        stopping,
        new Promise((resolve) => setTimeout(resolve, 1_000, 'still waiting')),
      ]);
      connection.destroy();
      await stopping;

      expect(outcome).toBe('stopped');
    });
  },
);
