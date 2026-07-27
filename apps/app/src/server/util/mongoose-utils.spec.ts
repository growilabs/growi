import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Tests for getMongoPoolOptions() - reads env vars and returns pool size config.
// These tests are written BEFORE the implementation (TDD red phase).

describe('getMongoPoolOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env vars before each test
    process.env = { ...originalEnv };
    delete process.env.MONGO_MAX_POOL_SIZE;
    delete process.env.MONGO_MIN_POOL_SIZE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns defaults when no env vars are set', async () => {
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    expect(result.maxPoolSize).toBe(15);
    expect(result.minPoolSize).toBe(2);
  });

  it('returns configured values when valid env vars are set', async () => {
    process.env.MONGO_MAX_POOL_SIZE = '5';
    process.env.MONGO_MIN_POOL_SIZE = '1';
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    expect(result.maxPoolSize).toBe(5);
    expect(result.minPoolSize).toBe(1);
  });

  it('falls back to default maxPoolSize when MONGO_MAX_POOL_SIZE is NaN', async () => {
    process.env.MONGO_MAX_POOL_SIZE = 'abc';
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    expect(result.maxPoolSize).toBe(15);
  });

  it('falls back to default minPoolSize when MONGO_MIN_POOL_SIZE is NaN', async () => {
    process.env.MONGO_MIN_POOL_SIZE = 'abc';
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    expect(result.minPoolSize).toBe(2);
  });

  it('falls back to defaults when env vars are empty strings', async () => {
    // Number('') === 0, which must not be treated as a valid pool size
    process.env.MONGO_MAX_POOL_SIZE = '';
    process.env.MONGO_MIN_POOL_SIZE = '';
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    expect(result.maxPoolSize).toBe(15);
    expect(result.minPoolSize).toBe(2);
  });

  it('falls back to default maxPoolSize when MONGO_MAX_POOL_SIZE is not positive', async () => {
    process.env.MONGO_MAX_POOL_SIZE = '0';
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    expect(result.maxPoolSize).toBe(15);
  });

  it('falls back to default minPoolSize when MONGO_MIN_POOL_SIZE is negative', async () => {
    process.env.MONGO_MIN_POOL_SIZE = '-1';
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    expect(result.minPoolSize).toBe(2);
  });

  it('clamps minPoolSize to maxPoolSize when min > max', async () => {
    process.env.MONGO_MAX_POOL_SIZE = '10';
    process.env.MONGO_MIN_POOL_SIZE = '15';
    const { getMongoPoolOptions } = await import('./mongoose-utils');
    const result = getMongoPoolOptions();
    // minPoolSize must not exceed maxPoolSize
    expect(result.minPoolSize).toBeLessThanOrEqual(result.maxPoolSize);
    expect(result.maxPoolSize).toBe(10);
  });
});

describe('mongoOptions', () => {
  it('includes maxPoolSize and minPoolSize properties', async () => {
    const { mongoOptions } = await import('./mongoose-utils');
    expect(mongoOptions).toHaveProperty('maxPoolSize');
    expect(mongoOptions).toHaveProperty('minPoolSize');
  });

  it('preserves useUnifiedTopology: true', async () => {
    const { mongoOptions } = await import('./mongoose-utils');
    expect(
      (mongoOptions as { useUnifiedTopology: boolean }).useUnifiedTopology,
    ).toBe(true);
  });
});
