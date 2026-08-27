import { CONFIG_DEFINITIONS } from '~/server/service/config-manager/config-definition';

import { resolveUpsertQueuePacing } from './upsert-queue-pacing';

const mocks = vi.hoisted(() => ({ loggerWarn: vi.fn() }));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  }),
}));

/*
 * Numeric env vars reach config as a bare parseInt result, so an operator's typo arrives here as
 * NaN. Contract: an unusable value falls back to its declared default, per value.
 */
describe('resolveUpsertQueuePacing', () => {
  const DECLARED_DEFAULTS = {
    drainIntervalMs:
      CONFIG_DEFINITIONS['backlinks:drainIntervalMs'].defaultValue,
    dutyCyclePercent:
      CONFIG_DEFINITIONS['backlinks:dutyCyclePercent'].defaultValue,
  };

  beforeEach(() => {
    mocks.loggerWarn.mockClear();
  });

  it('passes configured positive integers through unchanged', () => {
    expect(
      resolveUpsertQueuePacing({ drainIntervalMs: 250, dutyCyclePercent: 80 }),
    ).toEqual({ drainIntervalMs: 250, dutyCyclePercent: 80 });
  });

  // The reachable bad values: NaN from a non-numeric env var (config-loader uses a bare parseInt),
  // and 0 / negative from an operator trying to switch the queue off. NaN is the dangerous one —
  // every comparison against it is false, and an unguarded NaN duty cycle would compute a NaN
  // rest, which setTimeout coerces to 0, so the queue would never rest at all.
  it.each([
    Number.NaN,
    0,
    -1,
  ])('falls back to the declared defaults when the value is %p', (unusable) => {
    expect(
      resolveUpsertQueuePacing({
        drainIntervalMs: unusable,
        dutyCyclePercent: unusable,
      }),
    ).toEqual(DECLARED_DEFAULTS);
  });

  it('falls back only for the unusable value, keeping the other as configured', () => {
    expect(
      resolveUpsertQueuePacing({
        drainIntervalMs: Number.NaN,
        dutyCyclePercent: 80,
      }),
    ).toEqual({
      drainIntervalMs: DECLARED_DEFAULTS.drainIntervalMs,
      dutyCyclePercent: 80,
    });
  });

  // A duty cycle is a share of the loop, so anything over 100% is not a slower or faster setting
  // — it is meaningless, and would compute a negative rest.
  it.each([
    101, 200,
  ])('falls back when the duty cycle exceeds 100%% (%p)', (unusable) => {
    expect(
      resolveUpsertQueuePacing({
        drainIntervalMs: 250,
        dutyCyclePercent: unusable,
      }).dutyCyclePercent,
    ).toBe(DECLARED_DEFAULTS.dutyCyclePercent);
  });

  // Falling back silently would leave an operator with no way to find the typo, so the warning is
  // part of the contract, not a debug aid.
  it('warns about the value it ignored, and only about that one', () => {
    resolveUpsertQueuePacing({
      drainIntervalMs: Number.NaN,
      dutyCyclePercent: 80,
    });

    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'backlinks:drainIntervalMs',
        value: Number.NaN,
        defaultValue: DECLARED_DEFAULTS.drainIntervalMs,
      }),
      expect.any(String),
    );
  });
});
