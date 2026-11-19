import { CONFIG_DEFINITIONS } from '~/server/service/config-manager/config-definition';

import {
  BACKFILL_CHECKPOINT_INTERVAL_MS,
  BACKFILL_PAGE_RETRY_BACKOFF_MS,
  type BackfillPacing,
  backfillLeaseMsFor,
  longestBackfillRestMs,
  MAX_BACKFILL_PAGE_ATTEMPTS,
  resolveBackfillPacing,
  restAfterBackfillPageMs,
} from './backfill-pacing';
import { MAX_CHARGED_WORK_MS } from './duty-cycle-rest';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const pacing = (overrides: Partial<BackfillPacing> = {}): BackfillPacing => ({
  dutyCyclePercent: 25,
  maxPagesPerSecond: 20,
  maxBodyKiB: 256,
  ...overrides,
});

describe('resolveBackfillPacing', () => {
  const DECLARED_DEFAULTS = {
    dutyCyclePercent:
      CONFIG_DEFINITIONS['backlinks:backfillDutyCyclePercent'].defaultValue,
    maxPagesPerSecond:
      CONFIG_DEFINITIONS['backlinks:backfillMaxPagesPerSecond'].defaultValue,
    maxBodyKiB: CONFIG_DEFINITIONS['backlinks:backfillMaxBodyKiB'].defaultValue,
  };

  it('declares the backfill duty at 25%', () => {
    expect(DECLARED_DEFAULTS.dutyCyclePercent).toBe(25);
  });

  it('keeps usable configured values', () => {
    expect(
      resolveBackfillPacing({
        dutyCyclePercent: 10,
        maxPagesPerSecond: 5,
        maxBodyKiB: 64,
      }),
    ).toEqual({ dutyCyclePercent: 10, maxPagesPerSecond: 5, maxBodyKiB: 64 });
  });

  it.each([
    Number.NaN,
    0,
    -1,
    1.5,
  ])('falls back per value to the declared default for %s', (bad) => {
    expect(
      resolveBackfillPacing({
        dutyCyclePercent: bad,
        maxPagesPerSecond: bad,
        maxBodyKiB: bad,
      }),
    ).toEqual(DECLARED_DEFAULTS);
  });

  it('rejects a duty over 100%', () => {
    expect(
      resolveBackfillPacing({
        dutyCyclePercent: 101,
        maxPagesPerSecond: 5,
        maxBodyKiB: 64,
      }).dutyCyclePercent,
    ).toBe(DECLARED_DEFAULTS.dutyCyclePercent);
  });
});

describe('restAfterBackfillPageMs', () => {
  it('rests in proportion to the page cycle when that is slower than the rate floor', () => {
    // 100 ms at 25% owes 300 ms, more than the 50 ms floor at 20 pages/s.
    expect(restAfterBackfillPageMs(100, pacing())).toBeCloseTo(300);
  });

  it.each([
    0, 0.4, 1.3, 10, 49.9,
  ])('never lets a %s ms page start sooner than the rate floor allows', (cycleMs) => {
    const p = pacing({ dutyCyclePercent: 100, maxPagesPerSecond: 20 });

    expect(
      cycleMs + restAfterBackfillPageMs(cycleMs, p),
    ).toBeGreaterThanOrEqual(1000 / p.maxPagesPerSecond);
  });
});

describe('backfillLeaseMsFor', () => {
  it.each([
    pacing(),
    pacing({ dutyCyclePercent: 1 }),
    pacing({ dutyCyclePercent: 100, maxPagesPerSecond: 1 }),
  ])('outlasts the checkpoint interval, one page with its retry backoffs, and the longest single rest (%o)', (p) => {
    const retryBackoffsMs =
      (MAX_BACKFILL_PAGE_ATTEMPTS - 1) * BACKFILL_PAGE_RETRY_BACKOFF_MS;

    expect(backfillLeaseMsFor(p)).toBeGreaterThan(
      BACKFILL_CHECKPOINT_INTERVAL_MS +
        retryBackoffsMs +
        longestBackfillRestMs(p),
    );
  });

  it('takes the longest rest from the charge cap at the configured duty', () => {
    expect(longestBackfillRestMs(pacing())).toBe(3 * MAX_CHARGED_WORK_MS);
  });

  it('stays near one minute at the defaults, so a dead owner is taken over promptly', () => {
    expect(backfillLeaseMsFor(pacing())).toBeLessThanOrEqual(60_000);
  });
});
