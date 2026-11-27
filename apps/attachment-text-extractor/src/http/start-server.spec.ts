import { createServer } from 'node:http';

import { serverTimeouts } from './start-server';

// Node ends a request that is not fully received within requestTimeout with a
// 408 of its own, without an ErrorCode. The upload deadline (UPLOAD_TIMEOUT_S,
// counted once the headers are in) must answer first, with the table's 408
// `extraction_timeout`, whatever value the operator sets (research.md 27.7).

describe('serverTimeouts', () => {
  it.each([
    1, 15, 285, 300, 3_600,
  ])('leaves room for the headers and a %i s upload before Node cuts the request', (uploadTimeoutS) => {
    const { headersTimeout, requestTimeout } = serverTimeouts(uploadTimeoutS);

    expect(requestTimeout).toBeGreaterThan(
      headersTimeout + uploadTimeoutS * 1000,
    );
  });

  it.each([
    2_147_484,
    Number.MAX_SAFE_INTEGER,
  ])('gives timeouts Node accepts for an upload deadline of %d s', (uploadTimeoutS) => {
    const timeouts = serverTimeouts(uploadTimeoutS);

    expect(() => createServer(timeouts).close()).not.toThrow();
    // Above 32 bits the value could wrap into a short one.
    expect(timeouts.requestTimeout).toBeLessThan(2 ** 32);
    expect(timeouts.requestTimeout).toBeGreaterThan(2 ** 31);
  });
});
