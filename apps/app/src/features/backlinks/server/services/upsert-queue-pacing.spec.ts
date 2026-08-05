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
    maxPagesPerDrain:
      CONFIG_DEFINITIONS['backlinks:maxPagesPerDrain'].defaultValue,
  };

  beforeEach(() => {
    mocks.loggerWarn.mockClear();
  });

  it('passes configured positive integers through unchanged', () => {
    expect(
      resolveUpsertQueuePacing({ drainIntervalMs: 250, maxPagesPerDrain: 20 }),
    ).toEqual({ drainIntervalMs: 250, maxPagesPerDrain: 20 });
  });

  // The reachable bad values: NaN from a non-numeric env var (config-loader uses a bare parseInt),
  // and 0 / negative from an operator trying to switch the queue off. NaN is the dangerous one —
  // `batch.length >= NaN` never trips, so an unguarded NaN budget would let one tick parse the
  // whole queue instead of a bounded batch.
  it.each([
    Number.NaN,
    0,
    -1,
  ])('falls back to the declared defaults when the value is %p', (unusable) => {
    expect(
      resolveUpsertQueuePacing({
        drainIntervalMs: unusable,
        maxPagesPerDrain: unusable,
      }),
    ).toEqual(DECLARED_DEFAULTS);
  });

  it('falls back only for the unusable value, keeping the other as configured', () => {
    expect(
      resolveUpsertQueuePacing({
        drainIntervalMs: 250,
        maxPagesPerDrain: Number.NaN,
      }),
    ).toEqual({
      drainIntervalMs: 250,
      maxPagesPerDrain: DECLARED_DEFAULTS.maxPagesPerDrain,
    });
  });

  // Falling back silently would leave an operator with no way to find the typo, so the warning is
  // part of the contract, not a debug aid.
  it('warns about the value it ignored, and only about that one', () => {
    resolveUpsertQueuePacing({
      drainIntervalMs: 250,
      maxPagesPerDrain: Number.NaN,
    });

    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'backlinks:maxPagesPerDrain',
        value: Number.NaN,
        defaultValue: DECLARED_DEFAULTS.maxPagesPerDrain,
      }),
      expect.any(String),
    );
  });
});
