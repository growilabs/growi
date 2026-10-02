/**
 * RetryPolicy — pure exponential backoff calculation.
 *
 * No I/O, no side effects. All logic is derived solely from the inputs.
 */

export interface RetryConfig {
  /** Maximum number of attempts before escalating. env: VAULT_BOOTSTRAP_RETRY_MAX (default 5) */
  readonly maxAttempts: number;
  /** Base backoff in milliseconds. env: VAULT_BOOTSTRAP_RETRY_BASE_MS (default 30_000) */
  readonly baseBackoffMs: number;
  /** Maximum backoff cap in milliseconds. env: VAULT_BOOTSTRAP_RETRY_MAX_MS (default 1_800_000) */
  readonly maxBackoffMs: number;
}

export interface RetryDecision {
  /** Whether a retry should be attempted. False triggers escalation in the runner. */
  readonly shouldRetry: boolean;
  /** Next attempt number (previousAttempts + 1). Meaningful only when shouldRetry is true. */
  readonly attemptNo: number;
  /** Milliseconds to wait before the next attempt. 0 when shouldRetry is false. */
  readonly backoffMs: number;
}

/**
 * Decide whether to retry and compute the backoff duration.
 *
 * Formula: backoffMs = min(maxBackoffMs, baseBackoffMs * 2 ** previousAttempts) + jitter
 * Where jitter is a random value in [0, baseBackoffMs * 0.1].
 *
 * When previousAttempts >= maxAttempts, returns shouldRetry: false with backoffMs: 0.
 */
export const decideRetry = (
  config: RetryConfig,
  previousAttempts: number,
): RetryDecision => {
  if (previousAttempts >= config.maxAttempts) {
    return {
      shouldRetry: false,
      attemptNo: previousAttempts + 1,
      backoffMs: 0,
    };
  }

  const base = Math.min(
    config.maxBackoffMs,
    config.baseBackoffMs * 2 ** previousAttempts,
  );

  // Jitter: random value in [0, baseBackoffMs * 0.1]
  const maxJitter = config.baseBackoffMs * 0.1;
  const jitter = Math.random() * maxJitter;

  return {
    shouldRetry: true,
    attemptNo: previousAttempts + 1,
    backoffMs: base + jitter,
  };
};
