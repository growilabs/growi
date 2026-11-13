import { createHash } from 'node:crypto';

import { sendRaw } from '../../src/http/spec-support/raw-http';
import { useBlackboxService } from './blackbox-service';
import { itNodeOnly, type NodeOnlyReason } from './blackbox-target';
import {
  MULTIPART_CASES,
  type MultipartCase,
  REQUEST_TOKEN,
  rawRequest,
} from './multipart-cases';
import { type HttpResult, loadMultipartOracle } from './multipart-oracle';

// Black box (research.md 22.7 `multipart-raw`, 16.9 (a)): each raw request of
// multipart-cases.ts gets the status and code the Python service gave it
// (multipart-oracle.json). Where the Node service answers differently on
// purpose, the Node answer is written below with its research.md 22.5 reason
// and the test is skipped against Python.

const service = useBlackboxService();
const oracle = loadMultipartOracle();

const NOT_FOUND: HttpResult = { status: 404, code: null };
const INVALID: HttpResult = { status: 422, code: 'extraction_failed' };
const CONVERTED: HttpResult = { status: 200, code: null };

/** Cases the Node service answers differently from Python, and why (22.5). */
const NODE_ANSWERS: Readonly<
  Record<
    string,
    { readonly reason: NodeOnlyReason; readonly answer: HttpResult }
  >
> = {
  // 7.5 2: a CR in the boundary is refused
  d37: { reason: '7.5-2', answer: INVALID },
  // 7.5 3: the request charset is not read (names decoded as UTF-8, else latin-1)
  m58: { reason: '7.5-3', answer: CONVERTED },
  m61: { reason: '7.5-3', answer: CONVERTED },
  v11: { reason: '7.5-3', answer: CONVERTED },
  v18: { reason: '7.5-3', answer: CONVERTED },
  v10: { reason: '7.5-3', answer: CONVERTED },
  v01: { reason: '7.5-3', answer: INVALID },
  v02: { reason: '7.5-3', answer: INVALID },
  v16: { reason: '7.5-3', answer: INVALID },
  // 16.1: Python answers a bare 500; the error table says 422
  d36: { reason: '16.1', answer: INVALID },
  m21: { reason: '16.1', answer: INVALID },
  // 16.9: HTTP-layer differences, Node's answers as the prototype gave them (6.8 decides)
  y01: { reason: '16.9', answer: NOT_FOUND },
  y04: { reason: '16.9', answer: NOT_FOUND },
  y12: { reason: '16.9', answer: NOT_FOUND },
  y14: { reason: '16.9', answer: NOT_FOUND },
  y15: { reason: '16.9', answer: NOT_FOUND },
  y16: { reason: '16.9', answer: { status: 417, code: null } },
  y22: { reason: '16.9', answer: { status: 400, code: null } },
  y37: { reason: '16.9', answer: CONVERTED },
  y38: { reason: '16.9', answer: CONVERTED },
};

const recorded = (c: MultipartCase): HttpResult => {
  const result = oracle.get(c.id)?.http;
  if (result === undefined) throw new Error(`no recorded result for ${c.id}`);
  return result;
};

const answerTo = async (c: MultipartCase): Promise<HttpResult | null> => {
  const { address, token } = service();
  const answer = await sendRaw(
    address,
    rawRequest(c, token),
    10_000,
    c.request?.method === 'HEAD',
  );
  if (answer === null) return null;
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(answer.text);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      body = { ...parsed };
    }
  } catch {
    // not JSON: no code
  }
  if (answer.status === 200 && !Array.isArray(body.pages)) {
    // A 200 must carry the extraction; anything else cannot equal a recorded 200.
    return { status: 200, code: '<200 without pages>' };
  }
  const code = typeof body.code === 'string' ? body.code : null;
  return { status: answer.status, code };
};

describe('raw multipart requests (research.md 16.9 (a))', () => {
  it('the generator still builds the bytes the recorded results belong to', () => {
    const sha1 = (c: MultipartCase): string =>
      createHash('sha1').update(rawRequest(c, REQUEST_TOKEN)).digest('hex');

    expect(new Set(MULTIPART_CASES.map((c) => c.id)).size).toBe(
      MULTIPART_CASES.length,
    );
    expect(MULTIPART_CASES.map((c) => [c.id, sha1(c)])).toEqual(
      MULTIPART_CASES.map((c) => [c.id, oracle.get(c.id)?.requestSha1]),
    );
    expect(Object.keys(NODE_ANSWERS).filter((id) => !oracle.has(id))).toEqual(
      [],
    );
  });

  for (const c of MULTIPART_CASES) {
    const differs = NODE_ANSWERS[c.id];
    if (differs === undefined) {
      it(`${c.id} ${c.about}`, async () => {
        expect(await answerTo(c)).toEqual(recorded(c));
      });
    } else {
      itNodeOnly(differs.reason, `${c.id} ${c.about}`, async () => {
        expect(recorded(c)).not.toEqual(differs.answer);
        expect(await answerTo(c)).toEqual(differs.answer);
      });
    }
  }
});
