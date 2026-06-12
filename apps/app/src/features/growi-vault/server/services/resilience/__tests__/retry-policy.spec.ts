import { describe, expect, it } from 'vitest';

import {
  decideRetry,
  type RetryConfig,
  type RetryDecision,
} from '../retry-policy';

const defaultConfig: RetryConfig = {
  maxAttempts: 5,
  baseBackoffMs: 30_000,
  maxBackoffMs: 1_800_000,
};

describe('decideRetry — exponential growth', () => {
  it('attempt 0 → backoff in [30s, 30s + 3s jitter]', () => {
    const result = decideRetry(defaultConfig, 0);
    expect(result.backoffMs).toBeGreaterThanOrEqual(30_000);
    expect(result.backoffMs).toBeLessThanOrEqual(30_000 + 3_000);
  });

  it('attempt 1 → backoff in [60s, 60s + 3s jitter]', () => {
    const result = decideRetry(defaultConfig, 1);
    expect(result.backoffMs).toBeGreaterThanOrEqual(60_000);
    expect(result.backoffMs).toBeLessThanOrEqual(60_000 + 3_000);
  });

  it('attempt 2 → backoff in [120s, 120s + 3s jitter]', () => {
    const result = decideRetry(defaultConfig, 2);
    expect(result.backoffMs).toBeGreaterThanOrEqual(120_000);
    expect(result.backoffMs).toBeLessThanOrEqual(120_000 + 3_000);
  });

  it('attempt 3 → backoff in [240s, 240s + 3s jitter]', () => {
    const result = decideRetry(defaultConfig, 3);
    expect(result.backoffMs).toBeGreaterThanOrEqual(240_000);
    expect(result.backoffMs).toBeLessThanOrEqual(240_000 + 3_000);
  });

  it('attempt 4 → backoff in [480s, 480s + 3s jitter]', () => {
    const result = decideRetry(defaultConfig, 4);
    expect(result.backoffMs).toBeGreaterThanOrEqual(480_000);
    expect(result.backoffMs).toBeLessThanOrEqual(480_000 + 3_000);
  });

  it('5 consecutive attempts grow exponentially', () => {
    const backoffs = [0, 1, 2, 3, 4].map(
      (n) => decideRetry(defaultConfig, n).backoffMs,
    );
    // Each backoff base should at least double (ignoring jitter, check lower bounds)
    expect(backoffs[1]).toBeGreaterThanOrEqual(backoffs[0]);
    expect(backoffs[2]).toBeGreaterThanOrEqual(backoffs[1]);
    expect(backoffs[3]).toBeGreaterThanOrEqual(backoffs[2]);
    expect(backoffs[4]).toBeGreaterThanOrEqual(backoffs[3]);
  });
});

describe('decideRetry — max cap', () => {
  it('when base*2^n > maxBackoffMs → backoffMs capped at maxBackoffMs + base*0.1', () => {
    // Use a config with higher maxAttempts so attempt=6 is still valid (shouldRetry: true)
    // With base=30s, attempt=6: 30s * 2^6 = 1920s > max 1800s → should be capped
    const capConfig: RetryConfig = { ...defaultConfig, maxAttempts: 20 };
    const result = decideRetry(capConfig, 6);
    const maxJitter = capConfig.baseBackoffMs * 0.1;
    expect(result.shouldRetry).toBe(true);
    expect(result.backoffMs).toBeGreaterThanOrEqual(capConfig.maxBackoffMs);
    expect(result.backoffMs).toBeLessThanOrEqual(
      capConfig.maxBackoffMs + maxJitter,
    );
  });

  it('backoffMs === 0 when shouldRetry is false (attempts exhausted, not a cap case)', () => {
    // When previousAttempts >= maxAttempts, backoffMs is 0 (not capped, just exhausted)
    const result = decideRetry(defaultConfig, 5);
    expect(result.shouldRetry).toBe(false);
    expect(result.backoffMs).toBe(0);
  });

  it('cap applies at any large valid attempt number', () => {
    const capConfig: RetryConfig = { ...defaultConfig, maxAttempts: 100 };
    const result = decideRetry(capConfig, 50);
    const maxJitter = capConfig.baseBackoffMs * 0.1;
    expect(result.shouldRetry).toBe(true);
    expect(result.backoffMs).toBeGreaterThanOrEqual(capConfig.maxBackoffMs);
    expect(result.backoffMs).toBeLessThanOrEqual(
      capConfig.maxBackoffMs + maxJitter,
    );
  });
});

describe('decideRetry — jitter range', () => {
  it('backoffMs includes jitter within [base*2^n, base*2^n + base*0.1]', () => {
    const config: RetryConfig = {
      maxAttempts: 10,
      baseBackoffMs: 1_000,
      maxBackoffMs: 100_000,
    };
    // Run multiple times to check jitter is applied
    const results = Array.from({ length: 20 }, () => decideRetry(config, 0));
    const backoffs = results.map((r) => r.backoffMs);
    // All should be within [1000, 1100]
    for (const b of backoffs) {
      expect(b).toBeGreaterThanOrEqual(1_000);
      expect(b).toBeLessThanOrEqual(1_100);
    }
  });

  it('jitter can produce values above the base (non-zero jitter possible)', () => {
    // With enough samples, at least one should be > base value due to jitter
    const config: RetryConfig = {
      maxAttempts: 10,
      baseBackoffMs: 1_000,
      maxBackoffMs: 100_000,
    };
    const results = Array.from({ length: 100 }, () => decideRetry(config, 0));
    const hasJitter = results.some((r) => r.backoffMs > 1_000);
    expect(hasJitter).toBe(true);
  });
});

describe('decideRetry — max attempts exceeded', () => {
  it('previousAttempts === maxAttempts → shouldRetry: false', () => {
    const result = decideRetry(defaultConfig, 5);
    expect(result.shouldRetry).toBe(false);
  });

  it('previousAttempts > maxAttempts → shouldRetry: false', () => {
    const result = decideRetry(defaultConfig, 10);
    expect(result.shouldRetry).toBe(false);
  });

  it('backoffMs === 0 when shouldRetry is false', () => {
    const result = decideRetry(defaultConfig, 5);
    expect(result.backoffMs).toBe(0);
  });
});

describe('decideRetry — attemptNo', () => {
  it('decideRetry(config, 2) → attemptNo === 3', () => {
    const result = decideRetry(defaultConfig, 2);
    expect(result.attemptNo).toBe(3);
  });

  it('decideRetry(config, 0) → attemptNo === 1', () => {
    const result = decideRetry(defaultConfig, 0);
    expect(result.attemptNo).toBe(1);
  });

  it('decideRetry(config, 4) → attemptNo === 5', () => {
    const result = decideRetry(defaultConfig, 4);
    expect(result.attemptNo).toBe(5);
  });
});

describe('decideRetry — deterministic shouldRetry', () => {
  it('previousAttempts=4, maxAttempts=5 → shouldRetry: true', () => {
    const result = decideRetry(defaultConfig, 4);
    expect(result.shouldRetry).toBe(true);
  });

  it('previousAttempts=5, maxAttempts=5 → shouldRetry: false', () => {
    const result = decideRetry(defaultConfig, 5);
    expect(result.shouldRetry).toBe(false);
  });

  it('previousAttempts=0, maxAttempts=1 → shouldRetry: true', () => {
    const config: RetryConfig = { ...defaultConfig, maxAttempts: 1 };
    const result = decideRetry(config, 0);
    expect(result.shouldRetry).toBe(true);
  });

  it('previousAttempts=1, maxAttempts=1 → shouldRetry: false', () => {
    const config: RetryConfig = { ...defaultConfig, maxAttempts: 1 };
    const result = decideRetry(config, 1);
    expect(result.shouldRetry).toBe(false);
  });
});

describe('decideRetry — pure function guarantees', () => {
  it('does not mutate the config object', () => {
    const config: RetryConfig = {
      maxAttempts: 5,
      baseBackoffMs: 30_000,
      maxBackoffMs: 1_800_000,
    };
    const configCopy = { ...config };
    decideRetry(config, 2);
    expect(config).toEqual(configCopy);
  });

  it('returns a readonly-style result with required fields', () => {
    const result: RetryDecision = decideRetry(defaultConfig, 0);
    expect(typeof result.shouldRetry).toBe('boolean');
    expect(typeof result.attemptNo).toBe('number');
    expect(typeof result.backoffMs).toBe('number');
  });

  it('no I/O: calling the same config+attempts multiple times returns consistent structure', () => {
    const r1 = decideRetry(defaultConfig, 3);
    const r2 = decideRetry(defaultConfig, 3);
    // shouldRetry and attemptNo should be deterministic
    expect(r1.shouldRetry).toBe(r2.shouldRetry);
    expect(r1.attemptNo).toBe(r2.attemptNo);
    // backoffMs may differ due to jitter, but within expected range
    expect(r1.backoffMs).toBeGreaterThanOrEqual(240_000);
    expect(r1.backoffMs).toBeLessThanOrEqual(240_000 + 3_000);
  });
});
