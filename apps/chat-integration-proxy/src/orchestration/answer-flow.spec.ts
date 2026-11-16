import {
  type ConversationResult,
  OP_NAMES,
  parseConversationResult,
} from '@growi/chat';
import { mock } from 'vitest-mock-extended';

import { testSdkChannel } from '../capabilities/test-channels.js';
import type { PrivateReplier } from '../command/index.js';
import type {
  PendingAgentRequestRecord,
  StoredAnswerOrigin,
} from '../db/index.js';
import type { PlatformFacade } from '../platform/index.js';
import type { HistoryMessage } from '../types/index.js';
import { channelAnswerRootOf, createAnswerFlow } from './answer-flow.js';

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

type ConversationRead = Parameters<PlatformFacade['fetchConversation']>;
type ConversationOutcome = Awaited<
  ReturnType<PlatformFacade['fetchConversation']>
>;

interface RecordedRead {
  readonly target: ConversationRead[0];
  readonly range: ConversationRead[1];
  readonly scope: ConversationRead[2];
}

const RELATION_ID = 'relation-1';
const INSTALLATION_ID = 'installation-1';
const NOW = new Date('2026-11-16T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const recordOf = (
  requestId: string,
  stored: StoredAnswerOrigin,
  overrides: Partial<PendingAgentRequestRecord> = {},
): PendingAgentRequestRecord => ({
  relationId: RELATION_ID,
  requestId,
  installationId: INSTALLATION_ID,
  origin: stored,
  deliveryStatus: null,
  deliveryClaimedAt: null,
  expiresAt: new Date(NOW.getTime() + DAY_MS),
  ...overrides,
});

const message = (
  postedAt: string,
  text: string,
  author: HistoryMessage['author'] = {
    platform: 'slack',
    accountId: 'U2',
    displayName: 'Bob',
  },
): HistoryMessage => ({ postedAt, author, text });

/**
 * The flow over records held in memory and a reader that answers what each
 * case scripts, keeping every read it was asked for.
 */
const flowOver = (
  records: ReadonlyArray<PendingAgentRequestRecord>,
  answer: (
    read: RecordedRead,
  ) => ConversationOutcome | Promise<never> = () => ({
    ok: true,
    messages: [],
    truncated: false,
  }),
) => {
  const reads: RecordedRead[] = [];
  const flow = createAnswerFlow({
    pendingAgentRequests: {
      find: async (relationId, requestId) =>
        records.find(
          (record) =>
            record.relationId === relationId && record.requestId === requestId,
        ) ?? null,
      claimDelivery: async () => false,
      recordDeliveryResult: async () => {},
    },
    relations: { findById: async () => null },
    privateReplier: mock<Pick<PrivateReplier, 'reply'>>(),
    platform: {
      ...mock<Pick<PlatformFacade, 'post' | 'postInThread'>>(),
      fetchConversation: async (target, range, scope) => {
        const read = { target, range, scope };
        reads.push(read);
        return await answer(read);
      },
    },
    reportOperationalFailure: () => {},
    now: () => NOW,
  });
  return { flow, reads };
};

const conversationRequest = (
  requestId: string,
  relationId: string = RELATION_ID,
) => ({ op: OP_NAMES.conversation, relationId, requestId });

const okResult = (
  result: ConversationResult,
): Extract<ConversationResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`expected a conversation, got ${result.failure.reason}`);
  }
  return result;
};

describe('reading the conversation a request was made in (Requirements 5.7, 5.14)', () => {
  it('reads the thread a request was made in, leaving out the request itself, as the recorded installation', async () => {
    const stored = origin({
      sourceMessageId: 'M-5',
      threadRootId: 'T-1',
      replyThreadRootId: 'T-1',
    });
    const { flow, reads } = flowOver([recordOf('req-1', stored)]);

    await flow.readConversation(conversationRequest('req-1'));

    expect(reads).toEqual([
      {
        target: stored.channel,
        range: { threadRootId: 'T-1', requestMessageId: 'M-5', limit: 200 },
        scope: { installationId: INSTALLATION_ID },
      },
    ]);
  });

  it('reads the latest messages of a DM for a request made outside a thread there, not the thread the answer goes to', async () => {
    // The real shape of a Slack DM request outside a thread: the answer goes
    // in the thread the request starts, but nothing was said in it yet.
    const stored = origin({
      channel: testSdkChannel('slack', { isPrivate: true }),
      place: 'direct',
      sourceMessageId: 'M-dm-1',
      threadRootId: null,
      replyThreadRootId: 'M-dm-1',
    });
    const latest = [
      message('2026-11-16T09:00:00.000Z', 'shall we ship on Friday?'),
      message('2026-11-16T09:05:00.000Z', 'yes, after the review'),
    ];
    const { flow, reads } = flowOver([recordOf('req-dm', stored)], (read) => ({
      ok: true,
      // Only a read of the place's latest messages finds anything.
      messages: read.range.threadRootId == null ? latest : [],
      truncated: false,
    }));

    const result = await flow.readConversation(conversationRequest('req-dm'));

    expect(reads.map((read) => read.range)).toEqual([
      { threadRootId: null, requestMessageId: 'M-dm-1', limit: 200 },
    ]);
    expect(okResult(result).messages.map((m) => m.markdown)).toEqual([
      'shall we ship on Friday?',
      'yes, after the review',
    ]);
  });

  it('hands over the messages read, with the range built from them and the reader’s truncation', async () => {
    const stored = origin({ threadRootId: 'T-1', replyThreadRootId: 'T-1' });
    const read = [
      message('2026-11-16T08:00:00.000Z', 'first'),
      message('2026-11-16T08:30:00.000Z', ''),
      message('2026-11-16T09:00:00.000Z', 'last'),
    ];
    const { flow } = flowOver([recordOf('req-1', stored)], () => ({
      ok: true,
      messages: read,
      truncated: true,
    }));

    const result = await flow.readConversation(conversationRequest('req-1'));

    expect(result).toEqual({
      ok: true,
      messages: [
        {
          postedAt: '2026-11-16T08:00:00.000Z',
          author: read[0].author,
          markdown: 'first',
        },
        // An attachment-only post keeps its empty body.
        {
          postedAt: '2026-11-16T08:30:00.000Z',
          author: read[1].author,
          markdown: '',
        },
        {
          postedAt: '2026-11-16T09:00:00.000Z',
          author: read[2].author,
          markdown: 'last',
        },
      ],
      range: {
        messageCount: 3,
        firstPostedAt: '2026-11-16T08:00:00.000Z',
        lastPostedAt: '2026-11-16T09:00:00.000Z',
      },
      truncated: true,
    });
    expect(parseConversationResult(result)).toEqual(result);
  });

  it('answers `empty` when the place has no message to summarize', async () => {
    const { flow } = flowOver([recordOf('req-1', origin())]);

    await expect(
      flow.readConversation(conversationRequest('req-1')),
    ).resolves.toEqual({
      ok: false,
      failure: { reason: 'empty', remedy: null },
    });
  });

  it.each([
    ['not-in-channel', 'invite the bot'],
    ['not-permitted', 'grant history access'],
    ['unsupported', null],
    ['rate-limited', null],
  ] as const)('answers the reader’s %s refusal with its remedy', async (reason, remedy) => {
    const { flow } = flowOver([recordOf('req-1', origin())], () => ({
      ok: false,
      reason,
      remedy,
    }));

    await expect(
      flow.readConversation(conversationRequest('req-1')),
    ).resolves.toEqual({ ok: false, failure: { reason, remedy } });
  });

  it('answers `unknown-request` without reading anything when no request is on record', async () => {
    const { flow, reads } = flowOver([]);

    await expect(
      flow.readConversation(conversationRequest('req-missing')),
    ).resolves.toEqual({
      ok: false,
      failure: { reason: 'unknown-request', remedy: null },
    });
    expect(reads).toEqual([]);
  });

  it('answers `unknown-request` to another relation asking about this relation’s request', async () => {
    const { flow, reads } = flowOver([recordOf('req-1', origin())]);

    await expect(
      flow.readConversation(conversationRequest('req-1', 'relation-other')),
    ).resolves.toEqual({
      ok: false,
      failure: { reason: 'unknown-request', remedy: null },
    });
    expect(reads).toEqual([]);
  });

  it('answers `unknown-request` once the request is past its expiry, even before the sweep', async () => {
    const { flow, reads } = flowOver([
      recordOf('req-1', origin(), { expiresAt: NOW }),
    ]);

    await expect(
      flow.readConversation(conversationRequest('req-1')),
    ).resolves.toEqual({
      ok: false,
      failure: { reason: 'unknown-request', remedy: null },
    });
    expect(reads).toEqual([]);
  });

  it('reads again however often it is asked while the request is on record', async () => {
    const { flow, reads } = flowOver([
      recordOf('req-1', origin(), { deliveryStatus: 'delivered' }),
    ]);

    await flow.readConversation(conversationRequest('req-1'));
    await flow.readConversation(conversationRequest('req-1'));

    expect(reads).toHaveLength(2);
  });

  it('lets a failure the reader has no reason for propagate', async () => {
    const { flow } = flowOver([recordOf('req-1', origin())], () =>
      Promise.reject(new Error('socket hang up')),
    );

    await expect(
      flow.readConversation(conversationRequest('req-1')),
    ).rejects.toThrow('socket hang up');
  });
});

describe('fitting what was read into what GROWI accepts (protocol limits)', () => {
  const readOne = async (read: HistoryMessage) => {
    const { flow } = flowOver([recordOf('req-1', origin())], () => ({
      ok: true,
      messages: [read],
      truncated: false,
    }));
    const result = await flow.readConversation(conversationRequest('req-1'));
    // What GROWI does with the answer first: one message over a limit would
    // refuse the whole conversation.
    expect(parseConversationResult(result)).toEqual(result);
    return okResult(result).messages[0];
  };

  it('pins the protocol’s limits the proxy fits into: 20,000 for a body, 200 for a name or an account id', () => {
    const conversationWith = (author: HistoryMessage['author'], body: string) =>
      parseConversationResult({
        ok: true,
        messages: [
          { postedAt: '2026-11-16T08:00:00.000Z', author, markdown: body },
        ],
        range: {
          messageCount: 1,
          firstPostedAt: '2026-11-16T08:00:00.000Z',
          lastPostedAt: '2026-11-16T08:00:00.000Z',
        },
        truncated: false,
      });
    const author = (displayName: string, accountId = 'U2') => ({
      platform: 'slack' as const,
      accountId,
      displayName,
    });

    expect(
      conversationWith(author('Bob'), 'x'.repeat(20_000)),
    ).not.toHaveProperty('error');
    expect(conversationWith(author('Bob'), 'x'.repeat(20_001))).toHaveProperty(
      'error',
    );
    expect(conversationWith(author('b'.repeat(200)), 'x')).not.toHaveProperty(
      'error',
    );
    expect(conversationWith(author('b'.repeat(201)), 'x')).toHaveProperty(
      'error',
    );
    expect(conversationWith(author('', 'U2'), 'x')).toHaveProperty('error');
    expect(
      conversationWith(author('Bob', 'u'.repeat(200)), 'x'),
    ).not.toHaveProperty('error');
    expect(
      conversationWith(author('Bob', 'u'.repeat(201)), 'x'),
    ).toHaveProperty('error');
  });

  it('cuts a body longer than 20,000 characters to the limit, marking the cut, rather than losing the conversation', async () => {
    const long = `${'a'.repeat(19_990)}${'b'.repeat(20_010)}`;

    const fitted = await readOne(message('2026-11-16T08:00:00.000Z', long));

    expect(fitted.markdown).toBe(`${long.slice(0, 19_999)}…`);
  });

  it('cuts a body of 20,001 characters too', async () => {
    const fitted = await readOne(
      message('2026-11-16T08:00:00.000Z', 'y'.repeat(20_001)),
    );

    expect(fitted.markdown).toBe(`${'y'.repeat(19_999)}…`);
  });

  it('keeps a body of exactly 20,000 characters as it is', async () => {
    const body = 'x'.repeat(20_000);

    const fitted = await readOne(message('2026-11-16T08:00:00.000Z', body));

    expect(fitted.markdown).toBe(body);
  });

  it('cuts a body of emoji without leaving half of a character behind', async () => {
    // Each emoji is two UTF-16 units, the unit the protocol counts.
    const emoji = '😀'.repeat(15_000);

    const fitted = await readOne(message('2026-11-16T08:00:00.000Z', emoji));

    expect(fitted.markdown).toBe(`${'😀'.repeat(9_999)}…`);
    expect(fitted.markdown.isWellFormed()).toBe(true);
  });

  it('cuts a display name longer than 200 characters', async () => {
    const fitted = await readOne(
      message('2026-11-16T08:00:00.000Z', 'hi', {
        platform: 'slack',
        accountId: 'U2',
        displayName: 'n'.repeat(250),
      }),
    );

    expect(fitted.author.displayName).toBe('n'.repeat(200));
  });

  it('cuts a display name of emoji without leaving half of a character behind', async () => {
    const fitted = await readOne(
      message('2026-11-16T08:00:00.000Z', 'hi', {
        platform: 'slack',
        accountId: 'U2',
        displayName: `a${'😀'.repeat(150)}`,
      }),
    );

    expect(fitted.author.displayName).toBe(`a${'😀'.repeat(99)}`);
  });

  it('keeps a display name of exactly 200 characters', async () => {
    const name = 'n'.repeat(200);

    const fitted = await readOne(
      message('2026-11-16T08:00:00.000Z', 'hi', {
        platform: 'slack',
        accountId: 'U2',
        displayName: name,
      }),
    );

    expect(fitted.author.displayName).toBe(name);
  });

  it('names an author the service gave no name by the account id', async () => {
    const fitted = await readOne(
      message('2026-11-16T08:00:00.000Z', 'hi', {
        platform: 'slack',
        accountId: 'U2',
        displayName: '',
      }),
    );

    expect(fitted.author).toEqual({
      platform: 'slack',
      accountId: 'U2',
      displayName: 'U2',
    });
  });

  it('cuts an account id longer than 200 characters', async () => {
    const fitted = await readOne(
      message('2026-11-16T08:00:00.000Z', 'hi', {
        platform: 'teams',
        accountId: 'a'.repeat(260),
        displayName: 'Carol',
      }),
    );

    expect(fitted.author.accountId).toBe('a'.repeat(200));
  });
});
