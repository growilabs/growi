import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { PlatformEvent, PlatformEventSink } from '../types/index.js';
import { createPrivateReplyTimingTrace } from './private-reply-timing.js';

const timing = {
  via: 'ephemeral',
  channelId: 'slack:C1',
  sourceMessageId: '1700000000.000100',
  beforeMs: Date.parse('2026-10-27T01:02:03.500Z'),
  afterMs: Date.parse('2026-10-27T01:02:03.900Z'),
  returnedId: '1700000000.000200',
  ok: true,
} as const;

describe('createPrivateReplyTimingTrace', () => {
  it('writes one line carrying the request id, the three clock readings, the returned id and the channel', async () => {
    const lines: string[] = [];
    const clock = vi.fn(() => Date.parse('2026-10-27T01:02:03.100Z'));
    const trace = createPrivateReplyTimingTrace((l) => lines.push(l), clock);
    const sink = mock<PlatformEventSink>();
    sink.handle.mockImplementation(() => {
      trace.traceTiming(timing);
      return Promise.resolve();
    });

    await trace.wrapSink(sink).handle(mock<PlatformEvent>());

    expect(lines).toEqual([
      '[private-reply-timing] via=ephemeral request_ts=1700000000.000100 received=2026-10-27T01:02:03.100Z before=2026-10-27T01:02:03.500Z after=2026-10-27T01:02:03.900Z returned_id=1700000000.000200 channel=slack:C1 thread=false ok=true',
    ]);
  });

  it('marks a missing request message and an unknown arrival time instead of guessing', () => {
    const lines: string[] = [];
    const trace = createPrivateReplyTimingTrace((l) => lines.push(l));

    trace.traceTiming({
      ...timing,
      sourceMessageId: null,
      returnedId: null,
      ok: false,
    });

    expect(lines[0]).toContain('request_ts=none');
    expect(lines[0]).toContain('received=unknown');
    expect(lines[0]).toContain('returned_id=none');
    expect(lines[0]).toContain('ok=false');
  });
});
