import {
  CLOCK_SKEW_MARGIN_MS,
  type EphemeralOrderingClock,
  MAX_ORDERING_DELAY_MS,
  orderingDelayMs,
  waitBeforeEphemeral,
  waitForLaterSecond,
} from './ephemeral-ordering.js';

// Request at 1793094064.14 s; the next second starts at ...065.000.
const REQUEST_ID = '1793094064.140309';
const NEXT_SECOND_MS = 1793094065 * 1000;

describe('orderingDelayMs', () => {
  it('waits until the next second plus the skew margin when posted in the request second', () => {
    const now = 1793094064 * 1000 + 600;
    expect(orderingDelayMs(REQUEST_ID, now)).toBe(
      NEXT_SECOND_MS + CLOCK_SKEW_MARGIN_MS - now,
    );
  });

  it('does not wait once the request second and margin have passed', () => {
    expect(
      orderingDelayMs(REQUEST_ID, NEXT_SECOND_MS + CLOCK_SKEW_MARGIN_MS),
    ).toBe(0);
    expect(orderingDelayMs(REQUEST_ID, NEXT_SECOND_MS + 5000)).toBe(0);
  });

  it.each([
    null,
    undefined,
    '',
    'abc',
    '1793094064',
    '1793094064.',
    'x.1',
  ])('does not wait for an id that is not a Slack ts (%s)', (id) => {
    expect(orderingDelayMs(id, 1793094064 * 1000)).toBe(0);
  });

  it('caps the wait when the clock is far behind the request', () => {
    expect(orderingDelayMs(REQUEST_ID, 0)).toBe(MAX_ORDERING_DELAY_MS);
  });
});

describe('waitForLaterSecond', () => {
  const clockAt = (nowMs: number, sleep: EphemeralOrderingClock['sleep']) => ({
    now: () => nowMs,
    sleep,
  });

  it('does not return before the sleep resolves, having asked for the computed delay', async () => {
    const now = 1793094064 * 1000 + 600;
    let release: () => void = () => undefined;
    const requested: number[] = [];
    const clock = clockAt(now, (ms) => {
      requested.push(ms);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    let returned: number | null = null;
    const pending = waitForLaterSecond(REQUEST_ID, clock).then((ms) => {
      returned = ms;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(requested).toEqual([NEXT_SECOND_MS + CLOCK_SKEW_MARGIN_MS - now]);
    expect(returned).toBeNull();

    release();
    await pending;

    expect(returned).toBe(NEXT_SECOND_MS + CLOCK_SKEW_MARGIN_MS - now);
  });

  it('never sleeps when no wait is needed', async () => {
    const sleep = vi.fn<EphemeralOrderingClock['sleep']>();
    const waited = await waitForLaterSecond(
      REQUEST_ID,
      clockAt(NEXT_SECOND_MS + 10_000, sleep),
    );
    expect(waited).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('still returns when the sleep fails', async () => {
    const clock = clockAt(1793094064 * 1000, () =>
      Promise.reject(new Error('sleep broke')),
    );
    await expect(
      waitForLaterSecond(REQUEST_ID, clock),
    ).resolves.toBeGreaterThan(0);
  });
});

describe('waitBeforeEphemeral', () => {
  const sleeps: number[] = [];
  const clock: EphemeralOrderingClock = {
    now: () => 1793094064 * 1000 + 600,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };

  beforeEach(() => {
    sleeps.length = 0;
  });

  it('waits on Slack for a request in the current second', async () => {
    await waitBeforeEphemeral('slack', REQUEST_ID, clock);
    expect(sleeps).toHaveLength(1);
  });

  it.each([
    'discord',
    'teams',
    'mattermost',
  ] as const)('does not wait on %s', async (platform) => {
    await expect(
      waitBeforeEphemeral(platform, REQUEST_ID, clock),
    ).resolves.toBe(0);
    expect(sleeps).toEqual([]);
  });
});
