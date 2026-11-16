import { testSdkChannel } from '../capabilities/test-channels.js';
import type { StoredAnswerOrigin } from '../db/index.js';
import { channelAnswerRootOf } from './answer-flow.js';

const origin = (
  overrides: Partial<StoredAnswerOrigin> = {},
): StoredAnswerOrigin => ({
  channel: testSdkChannel('slack'),
  actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
  sourceMessageId: 'M-1',
  threadRootId: null,
  replyThreadRootId: null,
  place: 'channel',
  requestSummary: 'agent what is GROWI',
  ...overrides,
});

describe('where a channel answer is shown (design.md AnswerFlow)', () => {
  it('answers a request made inside a thread in that thread', () => {
    const inThread = origin({ threadRootId: 'T-1', replyThreadRootId: 'T-1' });

    expect(channelAnswerRootOf(inThread, false)).toBe('T-1');
    expect(channelAnswerRootOf(inThread, true)).toBe('T-1');
  });

  it('answers a request outside a thread at the channel level while the service cannot show it in an unreplied thread', () => {
    expect(channelAnswerRootOf(origin(), false)).toBeNull();
  });

  it('starts a thread on the request message once the service can show it there', () => {
    expect(channelAnswerRootOf(origin(), true)).toBe('M-1');
  });

  it('stays at the channel level when there is no request message to thread on', () => {
    expect(
      channelAnswerRootOf(origin({ sourceMessageId: null }), true),
    ).toBeNull();
  });
});
