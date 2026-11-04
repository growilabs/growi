import { createSessionIdGenerator, FIXED_SESSION_ID_PATHS } from './session-id';

describe('createSessionIdGenerator with FIXED_SESSION_ID_PATHS', () => {
  const genid = createSessionIdGenerator(FIXED_SESSION_ID_PATHS);

  it.each([
    '/_api/v3/healthcheck',
    '/_api/v3/ai-usage',
  ])('returns the same ID on every request to %s', (path) => {
    expect(genid({ path })).toBe(genid({ path }));
  });

  it('gives each fixed path its own ID', () => {
    expect(genid({ path: '/_api/v3/healthcheck' })).not.toBe(
      genid({ path: '/_api/v3/ai-usage' }),
    );
  });

  it.each([
    '/login',
    '/_API/V3/AI-Usage',
    '/_api/v3/ai-usage/',
  ])('returns a fresh ID per request to %s', (path) => {
    const ids = new Set([genid({ path }), genid({ path }), genid({ path })]);

    expect(ids.size).toBe(3);
  });
});
