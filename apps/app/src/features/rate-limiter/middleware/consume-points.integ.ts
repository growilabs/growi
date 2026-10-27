/** biome-ignore-all lint/performance/noAwaitInLoops: Allow in tests */

import { faker } from '@faker-js/faker';

const testRateLimitErrorWhenExceedingMaxRequests = async (
  method: string,
  key: string,
  maxRequests: number,
): Promise<void> => {
  // dynamic import is used because rateLimiterMongo needs to be initialized after connecting to DB
  // Issue: https://github.com/animir/node-rate-limiter-flexible/issues/216
  const { consumePoints } = await import('./consume-points');
  let count = 0;
  try {
    for (let i = 1; i <= maxRequests + 1; i++) {
      count += 1;
      const res = await consumePoints(method, key, { method, maxRequests });
      if (count === maxRequests) {
        // Expect consumedPoints to be equal to maxRequest when maxRequest is reached
        expect(res?.consumedPoints).toBe(maxRequests);
        // Expect remainingPoints to be 0 when maxRequest is reached
        expect(res?.remainingPoints).toBe(0);
      }
      if (count > maxRequests) {
        throw new Error('Exception occurred');
      }
    }
  } catch (err) {
    // Expect rate limit error to be called
    expect(err.message).not.toBe('Exception occurred');
    // Expect rate limit error at maxRequest + 1
    expect(count).toBe(maxRequests + 1);
  }
};

// Same boundary assertions as above, but reaches `maxRequests - 1` with a single
// `penalty()` round-trip instead of a real consumePoints() call per point.
// `penalty()` goes through the identical `_upsert(..., forceExpire: false, ...)`
// path that `consume()` uses (see RateLimiterStoreAbstract in rate-limiter-flexible),
// so the seeded state is indistinguishable from `maxRequests - 1` real consumes
// having happened. This removes the O(maxRequests) sequential Mongo round-trips
// that made this test's wall time scale with maxRequests and therefore sensitive
// to CI runner load (#11718, #11719): only the two boundary-crossing calls go
// through the real `consumePoints` wrapper under test.
const testRateLimitErrorAtBoundary = async (
  method: string,
  key: string,
  maxRequests: number,
): Promise<void> => {
  const { consumePoints } = await import('./consume-points');
  const { rateLimiterFactory } = await import('./rate-limiter-factory');

  if (maxRequests > 1) {
    const rateLimiter = rateLimiterFactory.getOrCreateRateLimiter(
      key,
      maxRequests,
    );
    await rateLimiter.penalty(key, maxRequests - 1);
  }

  const atLimit = await consumePoints(method, key, { method, maxRequests });
  // Expect consumedPoints to be equal to maxRequest when maxRequest is reached
  expect(atLimit?.consumedPoints).toBe(maxRequests);
  // Expect remainingPoints to be 0 when maxRequest is reached
  expect(atLimit?.remainingPoints).toBe(0);

  // Expect rate limit error at maxRequest + 1
  await expect(
    consumePoints(method, key, { method, maxRequests }),
  ).rejects.toMatchObject({ remainingPoints: 0 });
};

describe('consume-points.ts', async () => {
  it('Should trigger a rate limit error when maxRequest is exceeded (maxRequest: 1)', async () => {
    // setup
    const method = 'GET';
    const key = 'test-key-1';
    const maxRequests = 1;

    await testRateLimitErrorWhenExceedingMaxRequests(method, key, maxRequests);
  });

  it('Should trigger a rate limit error at the boundary (maxRequest: 500)', async () => {
    // setup
    const method = 'GET';
    const key = 'test-key-2';
    const maxRequests = 500;

    await testRateLimitErrorAtBoundary(method, key, maxRequests);
    // This test now does 3 Mongo round-trips total regardless of maxRequests
    // (was up to 501 before). Locally that completes in well under 1s, but we
    // keep an explicit, modest timeout rather than dropping to the bare 5s
    // default outright: local devcontainer timing and the GitHub Actions
    // runner are not the same environment, and we don't yet have CI history
    // for this redesigned shape. Unlike the old O(maxRequests) version, this
    // budget no longer scales with maxRequests, so it isn't expected to need
    // bumping again — tighten it once CI confirms.
  }, 8_000);

  it('Should trigger a rate limit error at the boundary (maxRequest: {random integer between 1 and 1000})', async () => {
    // setup
    const method = 'GET';
    const key = 'test-key-3';
    const maxRequests = faker.number.int({ min: 1, max: 1000 });

    await testRateLimitErrorAtBoundary(method, key, maxRequests);
    // See the maxRequest:500 case above — same fixed 3-round-trip cost
    // regardless of the randomized maxRequests value.
  }, 8_000);
});
