import { MAX_CHARGED_WORK_MS, restMsFor } from './duty-cycle-rest';

/*
 * Contract shared by the live drain and the backfill: after `workMs` of thread time, rest long
 * enough that work is `dutyCyclePercent` of (work + rest), with the charge capped.
 */
describe('restMsFor', () => {
  it.each([
    // [workMs, duty, expected rest]
    [100, 25, 300],
    [100, 20, 400],
    [10, 50, 10],
    [80, 100, 0],
  ])('rests %s ms of work at %s%% duty for %s ms', (workMs, duty, expected) => {
    expect(restMsFor(workMs, duty)).toBeCloseTo(expected);
  });

  it('keeps the configured duty exact over work plus rest', () => {
    const workMs = 37;
    const restMs = restMsFor(workMs, 25);

    expect(workMs / (workMs + restMs)).toBeCloseTo(0.25);
  });

  it('charges no more than the cap, however long the work took', () => {
    expect(restMsFor(MAX_CHARGED_WORK_MS * 10, 25)).toBe(
      restMsFor(MAX_CHARGED_WORK_MS, 25),
    );
    expect(restMsFor(MAX_CHARGED_WORK_MS, 25)).toBe(15_000);
  });

  it.each([
    0,
    -5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('owes no rest for an unusable measurement (%s)', (workMs) => {
    expect(restMsFor(workMs, 25)).toBe(0);
  });
});
