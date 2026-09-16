const ENV_VAR_NAME = 'ANONYMOUS_ES_SYNC_THRESHOLD_LOGIN';
const DEFAULT_THRESHOLD = 100;

// The module reads process.env once at import time, so each test needs a fresh
// module instance to observe a different env var state.
const importThresholds = async () => {
  const mod = await import('./anonymous-sync-thresholds');
  return mod.anonymousSyncThresholds;
};

describe('anonymousSyncThresholds', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env[ENV_VAR_NAME];
  });

  it('defaults every configured endpoint to the same launch placeholder when unset', async () => {
    const thresholds = await importThresholds();

    expect(thresholds['/login']).toBe(DEFAULT_THRESHOLD);
    expect(thresholds['/register']).toBe(DEFAULT_THRESHOLD);
    expect(thresholds['/forgot-password/.*']).toBe(DEFAULT_THRESHOLD);
  });

  it('uses the env var value when it is a valid positive number', async () => {
    process.env[ENV_VAR_NAME] = '500';

    const thresholds = await importThresholds();

    expect(thresholds['/login']).toBe(500);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['non-numeric', 'not-a-number'],
    ['empty string', ''],
  ])('falls back to the default for a %s env var value', async (_label, raw) => {
    process.env[ENV_VAR_NAME] = raw;

    const thresholds = await importThresholds();

    expect(thresholds['/login']).toBe(DEFAULT_THRESHOLD);
  });
});
