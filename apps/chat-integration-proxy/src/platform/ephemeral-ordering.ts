import type { PlatformName } from '@growi/chat';

import { EPHEMERAL_MUST_FOLLOW_REQUEST_SECOND } from '../capabilities/index.js';

// Slack gives an ephemeral message a synthetic `ts`: the current wall-clock
// second plus a counter in place of microseconds. Posted within the request's
// own second it sorts above the request. See research.md Decision P12 for the
// evidence and the rejected alternatives.

/** Clock and sleep, injectable so tests never wait in real time. */
export interface EphemeralOrderingClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const realEphemeralOrderingClock: EphemeralOrderingClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

// The skew between this proxy's clock and Slack's is unknown. This is an
// initial value that still has to be confirmed on a real workspace (research.md
// Decision P12); it only protects when the proxy clock is ahead of Slack's.
export const CLOCK_SKEW_MARGIN_MS = 250;

// A wrong clock must never stall a reply.
export const MAX_ORDERING_DELAY_MS = 1500;

const SLACK_TS = /^(\d+)\.\d+$/;

/**
 * Milliseconds to wait before posting an ephemeral so that it lands in a later
 * second than the request message. 0 when the id is not a Slack ts or the
 * moment has already passed.
 */
export const orderingDelayMs = (
  requestMessageId: string | null | undefined,
  nowMs: number,
): number => {
  if (requestMessageId == null) return 0;
  const seconds = SLACK_TS.exec(requestMessageId)?.[1];
  if (seconds == null) return 0;
  const requestSecond = Number(seconds);
  if (!Number.isSafeInteger(requestSecond)) return 0;
  const targetMs = (requestSecond + 1) * 1000 + CLOCK_SKEW_MARGIN_MS;
  return Math.min(Math.max(targetMs - nowMs, 0), MAX_ORDERING_DELAY_MS);
};

/** Waits as `orderingDelayMs` says; a failing sleep never blocks the post. */
export const waitForLaterSecond = async (
  requestMessageId: string | null | undefined,
  clock: EphemeralOrderingClock,
): Promise<number> => {
  const delayMs = orderingDelayMs(requestMessageId, clock.now());
  if (delayMs <= 0) return 0;
  try {
    await clock.sleep(delayMs);
  } catch {
    // Ordering is best effort; the reply still goes out.
  }
  return delayMs;
};

/** The wait for `platform`'s private reply; 0 on a service that needs none. */
export const waitBeforeEphemeral = async (
  platform: PlatformName,
  requestMessageId: string | null | undefined,
  clock: EphemeralOrderingClock,
): Promise<number> =>
  EPHEMERAL_MUST_FOLLOW_REQUEST_SECOND[platform]
    ? await waitForLaterSecond(requestMessageId, clock)
    : 0;
