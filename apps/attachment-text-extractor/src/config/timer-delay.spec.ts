import { MAX_TIMER_DELAY_MS, toTimerDelayMs } from './timer-delay';

describe('toTimerDelayMs', () => {
  it.each([
    [55, 55_000],
    [0.5, 500],
    [0, 0],
    [2_147_483, 2_147_483_000],
  ])('turns %d s into %d ms', (seconds, ms) => {
    expect(toTimerDelayMs(seconds)).toBe(ms);
  });

  it.each([
    2_147_484,
    3_000_000,
    Number.MAX_SAFE_INTEGER,
  ])('holds %d s at the longest delay a timer honours', (seconds) => {
    expect(toTimerDelayMs(seconds)).toBe(MAX_TIMER_DELAY_MS);
  });

  it('gives a delay that setTimeout takes without a TimeoutOverflowWarning', async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error): number => warnings.push(warning);
    process.on('warning', onWarning);

    clearTimeout(setTimeout(() => {}, toTimerDelayMs(3_000_000)));
    await new Promise((resolve) => setImmediate(resolve));

    process.off('warning', onWarning);
    expect(warnings.map((warning) => warning.name)).toEqual([]);
  });
});
