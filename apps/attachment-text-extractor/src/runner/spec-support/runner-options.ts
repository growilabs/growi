import { loadSettings, type Settings } from '../../config/load-settings';
import {
  type ConversionRunnerOptions,
  runnerOptionsFromSettings,
} from '../conversion-runner';

export const SERVICE_TOKEN_NAME = 'ATTACHMENT_EXTRACTOR_SERVICE_TOKEN';

/** Every awaited run is raced against this, so a supervision bug fails the test instead of hanging it. */
export const RUN_GUARD_MS = 30_000;

/** The production defaults, read the way main.ts reads them (no process.env). */
export const defaultSettings = (
  env: Readonly<Record<string, string>> = {},
): Settings => loadSettings({ [SERVICE_TOKEN_NAME]: 'spec-token', ...env });

/** Options built from the production defaults, with single options replaced. */
export const runnerOptions = (
  overrides: Partial<ConversionRunnerOptions> = {},
): ConversionRunnerOptions => ({
  ...runnerOptionsFromSettings(defaultSettings()),
  ...overrides,
});

/** Rejects if the promise has not settled in time. */
export const within = async <T>(
  promise: Promise<T>,
  ms: number = RUN_GUARD_MS,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`did not settle within ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
};

/** Settles either way and reports how; used where resolving and rejecting are both allowed. */
export const settle = async <T>(
  promise: Promise<T>,
): Promise<{ readonly settled: 'resolved' | 'rejected' }> => {
  try {
    await promise;
    return { settled: 'resolved' };
  } catch {
    return { settled: 'rejected' };
  }
};
