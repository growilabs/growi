import { setTimeout as sleep } from 'node:timers/promises';

import {
  MULTIPART_CASES,
  type MultipartCase,
  rawRequest,
} from '../../test/http/multipart-cases';
import { postFile } from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import { openConnection, type RawResponse } from './spec-support/raw-http';
import { type TestService, useTestService } from './spec-support/test-service';

// research.md 16.9 (c): however a request ends - answered, cut half way, sent
// in pieces or byte by byte - it gets an answer when it waits for one, and
// the only slot (MAX_CONCURRENCY=1) comes back, so the next request is 200.
// The requests are the raw cases of test/http/multipart-cases.ts.

vi.setConfig({ testTimeout: 120_000 });

const service = useTestService(() => ({
  runner: fakeRunner(),
  env: { MAX_CONCURRENCY: '1', UPLOAD_TIMEOUT_S: '2' },
}));
const BYTE_BY_BYTE_MAX = 1500;

type Mode = 'whole' | 'cut' | 'pieces' | 'bytes';

const sendIn = async (
  target: TestService,
  c: MultipartCase,
  mode: Mode,
): Promise<RawResponse | null> => {
  const bytes = rawRequest(c, target.token);
  const connection = await openConnection(target.address);
  const headOnly = c.request?.method === 'HEAD';
  try {
    if (mode === 'cut') {
      await connection.send(bytes.subarray(0, Math.floor(bytes.length / 2)));
      await sleep(20);
      return null;
    }
    if (mode === 'whole') {
      await connection.send(bytes);
    } else {
      const size = mode === 'bytes' ? 1 : Math.ceil(bytes.length / 3);
      for (let at = 0; at < bytes.length; at += size) {
        if (!(await connection.send(bytes.subarray(at, at + size)))) break;
      }
    }
    return await connection.response(5_000, headOnly);
  } finally {
    connection.destroy();
  }
};

const slotIsFree = async (target: TestService): Promise<boolean> => {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (
      (await postFile(target.url, 'a.txt', 'next', { token: target.token }))
        .status === 200
    )
      return true;
    await sleep(10);
  }
  return false;
};

const MODES: readonly Mode[] = ['whole', 'cut', 'pieces', 'bytes'];

describe('the slot comes back after every way a request can end (16.9 (c))', () => {
  it.each(MODES)('%s', async (mode) => {
    const target = service.current();
    const problems: string[] = [];
    const cases = MULTIPART_CASES.filter(
      (c) =>
        mode !== 'bytes' ||
        rawRequest(c, target.token).length <= BYTE_BY_BYTE_MAX,
    );

    for (const c of cases) {
      const answer = await sendIn(target, c, mode);
      if (mode !== 'cut' && answer === null)
        problems.push(`${c.id}: no answer`);
      if (!(await slotIsFree(target)))
        problems.push(`${c.id}: the slot did not come back`);
    }

    expect(cases.length).toBeGreaterThan(mode === 'bytes' ? 100 : 170);
    expect(problems).toEqual([]);
  });
});
