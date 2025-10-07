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
      // eslint-disable-next-line no-await-in-loop
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

describe('consume-points.ts', async () => {
  it('Should trigger a rate limit error when maxRequest is exceeded (maxRequest: 1)', async () => {
    // setup
    const method = 'GET';
    const key = 'test-key-1';
    const maxRequests = 1;

    await testRateLimitErrorWhenExceedingMaxRequests(method, key, maxRequests);
  });

  it('Should trigger a rate limit error when maxRequest is exceeded (maxRequest: 500)', async () => {
    // setup
    const method = 'GET';
    const key = 'test-key-2';
    const maxRequests = 500;

    await testRateLimitErrorWhenExceedingMaxRequests(method, key, maxRequests);
  });

  it('Should trigger a rate limit error when maxRequest is exceeded (maxRequest: {random integer between 1 and 1000})', async () => {
    // setup
    const method = 'GET';
    const key = 'test-key-3';
    const maxRequests = faker.number.int({ min: 1, max: 1000 });

    await testRateLimitErrorWhenExceedingMaxRequests(method, key, maxRequests);
  });
});
