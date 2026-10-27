// Temporary diagnostics for "a private reply shows above the user's own
// request on Slack": one stderr line per private reply with the clock
// readings needed to tell whether the order was decided by the proxy or by
// Slack. Lives in `runtime/` because only this layer may write to stderr.
import { AsyncLocalStorage } from 'node:async_hooks';

import type { PrivateReplyTiming } from '../command/index.js';
import type { PlatformEventSink } from '../types/index.js';

export const PRIVATE_REPLY_TIMING_PREFIX = '[private-reply-timing]';

export interface PrivateReplyTimingTrace {
  /** Stamps the arrival time of each event for the replies it causes. */
  readonly wrapSink: (sink: PlatformEventSink) => PlatformEventSink;
  readonly traceTiming: (timing: PrivateReplyTiming) => void;
  /** Records how long a private post waited, for the reply being handled. */
  readonly recordWait: (waitedMs: number) => void;
}

const isoOf = (epochMs: number): string => new Date(epochMs).toISOString();

export const createPrivateReplyTimingTrace = (
  write: (line: string) => void,
  now: () => number = Date.now,
): PrivateReplyTimingTrace => {
  const arrival = new AsyncLocalStorage<{
    readonly receivedAtMs: number;
    waitedMs: number;
  }>();

  return {
    wrapSink: (sink) => ({
      handle: (event) =>
        arrival.run({ receivedAtMs: now(), waitedMs: 0 }, () =>
          sink.handle(event),
        ),
    }),
    recordWait: (waitedMs) => {
      const store = arrival.getStore();
      if (store != null) store.waitedMs = waitedMs;
    },
    traceTiming: (timing) => {
      const received = arrival.getStore()?.receivedAtMs;
      // The facade addresses a private post at the channel, never a thread.
      write(
        [
          PRIVATE_REPLY_TIMING_PREFIX,
          `via=${timing.via}`,
          `request_ts=${timing.sourceMessageId ?? 'none'}`,
          `received=${received == null ? 'unknown' : isoOf(received)}`,
          `waited_ms=${arrival.getStore()?.waitedMs ?? 0}`,
          `before=${isoOf(timing.beforeMs)}`,
          `after=${isoOf(timing.afterMs)}`,
          `returned_id=${timing.returnedId ?? 'none'}`,
          `channel=${timing.channelId}`,
          'thread=false',
          `ok=${timing.ok}`,
        ].join(' '),
      );
    },
  };
};
