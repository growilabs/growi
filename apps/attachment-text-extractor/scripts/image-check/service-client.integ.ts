import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getPath, jsonOf } from '../../src/http/spec-support/extract-client';
import {
  realRunner,
  startTestService,
  type TestService,
} from '../../src/http/spec-support/test-service';
import { killStrayChildren } from '../../src/runner/spec-support';
import { SAMPLES } from './samples';

// Req 8.2, 9.1, 9.5: the checks the image job runs inside the container
// (no network, so they cannot run from outside it). The client is started
// here the way the job starts it in the container: its source handed to
// `node -e`, the token in the environment, the file on stdin. The service
// is the production HTTP layer with real children. Python
// test_smoke_extract.py.

const SOURCE = readFileSync(
  fileURLToPath(new URL('./service-client.mjs', import.meta.url)),
  'utf8',
);

interface Finished {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const client = (
  args: readonly string[],
  {
    token,
    stdin = Buffer.alloc(0),
  }: { readonly token: string; readonly stdin?: Uint8Array },
): Promise<Finished> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', SOURCE, '--', ...args],
      {
        env: { ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: token },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (data: Buffer) => out.push(data));
    child.stderr.on('data', (data: Buffer) => err.push(data));
    child.once('error', reject);
    child.once('close', (status) =>
      resolve({
        status,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      }),
    );
    child.stdin.end(stdin);
  });

describe.skipIf(process.platform !== 'linux')(
  'scripts/image-check/service-client.mjs',
  { timeout: 60_000 },
  () => {
    let service: TestService | undefined;
    const target = (): TestService => {
      if (service === undefined) throw new Error('the service is not started');
      return service;
    };
    const at = (): readonly string[] => ['--base-url', target().url];

    beforeAll(async () => {
      service = await startTestService(realRunner());
    });
    afterAll(async () => {
      await service?.close();
      await killStrayChildren();
    });

    describe('readyz', () => {
      it('exits 0 when the service is ready', async () => {
        const result = await client(['readyz', ...at()], {
          token: target().token,
        });

        expect(result.status).toBe(0);
      });

      it('exits non-zero when nothing listens at the address', async () => {
        const result = await client(
          ['readyz', '--base-url', 'http://127.0.0.1:9'],
          { token: target().token },
        );

        expect(result.status).not.toBe(0);
        expect(result.status).not.toBeNull();
      });
    });

    describe('extract', () => {
      it.each(
        SAMPLES,
      )('exits 0 when the $fileName sample comes back with its marker', async ({
        fileName,
        mimeType,
        marker,
        build,
      }) => {
        const result = await client(
          [
            'extract',
            ...at(),
            '--filename',
            fileName,
            '--mime',
            mimeType,
            '--expect',
            marker,
          ],
          { token: target().token, stdin: build() },
        );

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
      });

      it('exits non-zero when the extracted text lacks the expected marker', async () => {
        const [sample] = SAMPLES;

        const result = await client(
          [
            'extract',
            ...at(),
            '--filename',
            sample.fileName,
            '--mime',
            sample.mimeType,
            '--expect',
            'a marker the sample does not hold',
          ],
          { token: target().token, stdin: sample.build() },
        );

        expect(result.status).not.toBe(0);
        expect(result.status).not.toBeNull();
      });

      it('exits non-zero when the service refuses the token', async () => {
        const [sample] = SAMPLES;

        const result = await client(
          [
            'extract',
            ...at(),
            '--filename',
            sample.fileName,
            '--mime',
            sample.mimeType,
            '--expect',
            sample.marker,
          ],
          { token: 'not-the-token', stdin: sample.build() },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('401');
      });

      it('never prints the token', async () => {
        const [sample] = SAMPLES;

        const result = await client(
          [
            'extract',
            ...at(),
            '--filename',
            sample.fileName,
            '--mime',
            sample.mimeType,
            '--expect',
            'a marker the sample does not hold',
          ],
          { token: target().token, stdin: sample.build() },
        );

        expect(result.stdout + result.stderr).not.toContain(target().token);
      });
    });

    describe('openapi', () => {
      it('prints the document GET /openapi.json serves', async () => {
        const served = jsonOf(await getPath(target().url, '/openapi.json'));

        const result = await client(['openapi', ...at()], {
          token: target().token,
        });

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toStrictEqual(served);
      });
    });

    describe('prlimit', () => {
      it('exits 0 when a process started under prlimit has the limits asked for', async () => {
        const result = await client(['prlimit'], { token: target().token });

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
      });

      it('exits non-zero when prlimit cannot be run', async () => {
        const result = await client(
          ['prlimit', '--prlimit-path', '/nonexistent/prlimit'],
          { token: target().token },
        );

        expect(result.status).not.toBe(0);
        expect(result.status).not.toBeNull();
      });
    });

    it('exits non-zero for a command it does not know', async () => {
      const result = await client(['unknown'], { token: target().token });

      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
    });
  },
);
