import { setTimeout as sleep } from 'node:timers/promises';

import {
  errorOf,
  extractedOf,
  postFile,
} from '../../src/http/spec-support/extract-client';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from '../../src/http/spec-support/multipart';
import {
  openConnection,
  type RawConnection,
  requestHead,
} from '../../src/http/spec-support/raw-http';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `intake`): what the default limits do before a
// conversion starts. Req 3.1: a declared Content-Length over the cap is 413
// without the body; `Expect: 100-continue` gets no 100 for such a body (16.5);
// Req 3.6: a CSV one byte over the default 8 MiB cap is refused. Python
// test_live_server.py TestIntakeOrder (first row) and test_e2e_http.py
// TestInputSizeCapsOverHttp (default cap row). Rows that need other limits are
// in src/http/receive-upload.integ.ts.

const service = useBlackboxService();
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const uploadHead = (
  declaredFileBytes: number,
  extra: readonly string[] = [],
): Buffer => {
  const { token } = service();
  return requestHead({
    token,
    contentType: multipartContentType(),
    contentLength:
      fileHead('a.txt').length + declaredFileBytes + bodyTail().length,
    extra,
  });
};

const withConnection = async <T>(
  run: (connection: RawConnection) => Promise<T>,
): Promise<T> => {
  const connection = await openConnection(service().address);
  try {
    return await run(connection);
  } finally {
    connection.destroy();
  }
};

const waitForInterim = async (
  connection: RawConnection,
  timeoutMs: number,
): Promise<readonly number[]> => {
  const deadline = Date.now() + timeoutMs;
  while (connection.interim().length === 0 && Date.now() < deadline) {
    await sleep(10);
  }
  return connection.interim();
};

describe('declared Content-Length over the cap', () => {
  it('is 413 file_too_large without the body being sent', async () => {
    const answer = await withConnection(async (connection) => {
      await connection.send(uploadHead(10 * GIB));
      return connection.response(5_000);
    });

    expect(answer?.status).toBe(413);
    expect(answer?.text).toContain('"file_too_large"');
    // The message names the limit (Python test_limits.py).
    expect(answer?.text).toContain('50 MiB');
    const { url, token } = service();
    expect(
      (await postFile(url, 'ok.txt', 'still serving', { token })).status,
    ).toBe(200);
  });

  it('with `Expect: 100-continue` gets the 413 and no 100 Continue', async () => {
    await withConnection(async (connection) => {
      await connection.send(uploadHead(10 * GIB, ['Expect: 100-continue']));

      const answer = await connection.response(5_000);

      expect(answer?.status).toBe(413);
      expect(connection.interim()).toEqual([]);
    });
  });
});

describe('`Expect: 100-continue` within the cap', () => {
  it('gets 100 Continue, then the extraction once the body is sent', async () => {
    await withConnection(async (connection) => {
      const file = Buffer.from('continued body');
      await connection.send(uploadHead(file.length, ['Expect: 100-continue']));

      expect(await waitForInterim(connection, 5_000)).toEqual([100]);

      await connection.send(
        Buffer.concat([fileHead('a.txt'), file, bodyTail()]),
      );
      const answer = await connection.response(10_000);

      expect(answer?.status).toBe(200);
      expect(answer?.text).toContain('continued body');
    });
  });
});

describe('the CSV size cap at its default (8 MiB)', () => {
  it('refuses a CSV one byte over the cap with 422 resource_limit_exceeded', async () => {
    const { url, token } = service();
    const csv = Buffer.concat([
      Buffer.from('a,b\n'.repeat(2 * MIB)),
      Buffer.from('x'),
    ]);

    const answer = await postFile(url, 'big.csv', csv, { token });

    expect(answer.status).toBe(422);
    expect(errorOf(answer)).toEqual({
      code: 'resource_limit_exceeded',
      message: 'limit_exceeded: the document exceeds a processing limit',
      keys: ['code', 'message'],
    });
  });

  it('converts a small CSV (the cap does not refuse everything)', async () => {
    const { url, token } = service();

    const answer = await postFile(url, 'small.csv', 'a,b\n1,2\n', { token });

    expect(extractedOf(answer).pages[0]?.content).toContain('| a | b |');
  });
});
