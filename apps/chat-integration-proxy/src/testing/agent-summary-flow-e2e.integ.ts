// The summary flow of `agent`: someone asks for "this conversation" to be
// summarised into a page. GROWI accepts, then asks the proxy for the
// conversation; the proxy reads the place the request was made in -- that
// thread of that channel and nothing else -- and, once GROWI has made the
// page, the requester reads where it is (Requirements 5.7, 5.8, 15.7).
//
// The setup is `agent-e2e-fixture.ts`'s; see `agent-channel-flow-e2e.integ.ts`
// for what this kind of suite asserts.
import { randomUUID } from 'node:crypto';
import { OP_ENDPOINTS, OP_NAMES } from '@growi/chat';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { levelOf } from '../capabilities/index.js';
import type { HistoryMessage, SdkChannelRef } from '../types/index.js';
import {
  type AgentE2e,
  ANSWER_HEADER,
  agentE2eScope,
  agentRequestsTo,
  requestIdOf,
} from './agent-e2e-fixture.js';
import {
  actorOn,
  channelOn,
  mentionOn,
  sdkChannelIdOn,
} from './chat-events.js';
import type {
  CapturedConversationRead,
  FakeChatScript,
} from './fake-chat-service.js';
import { startFakeGrowi } from './fake-growi.js';

type ConversationReader = NonNullable<FakeChatScript['fetchConversation']>;

const scope = agentE2eScope();
afterEach(() => scope.close());

const SUMMARY_REQUEST = 'この会話を要約してページにして';
const PAGE_URL = 'http://growi.test/user/ada/memo/2026/11/16/release';

const bob = actorOn('slack', { accountId: 'U-bob', displayName: 'Bob' });

const said = (postedAt: string, text: string): HistoryMessage => ({
  postedAt,
  author: bob,
  text,
});

/** The thread the summary is asked for in, as the chat service holds it. */
const THREAD = [
  said('2026-11-16T08:00:00.000Z', 'which day do we ship?'),
  // Longer than one message may be when handed to GROWI.
  said('2026-11-16T08:10:00.000Z', 'z'.repeat(25_000)),
];

/**
 * What the chat service answers, per place. Only the request's own thread
 * holds the conversation; the channel's top level and another channel's
 * thread of the same id hold text that must never reach GROWI.
 */
const historiesFor = (
  channel: SdkChannelRef,
  threadRootId: string,
): ConversationReader => {
  const elsewhere = channelOn('slack', {
    channelId: sdkChannelIdOn('slack', `C-other-${randomUUID()}`),
  });
  const histories = new Map<string, ReadonlyArray<HistoryMessage>>([
    [`${channel.channelId}|${threadRootId}`, THREAD],
    [
      `${channel.channelId}|`,
      [said('2026-11-16T07:00:00.000Z', 'lunch at noon?')],
    ],
    [
      `${elsewhere.channelId}|${threadRootId}`,
      [said('2026-11-16T07:30:00.000Z', 'the other team’s secret')],
    ],
  ]);
  return (read) => ({
    ok: true,
    messages:
      histories.get(
        `${read.target.channelId}|${read.range.threadRootId ?? ''}`,
      ) ?? [],
    truncated: false,
  });
};

/**
 * Starts a workspace whose channel holds the histories above. The channel is
 * only known once the workspace exists, so the reader is filled in after.
 */
const startWithHistories = async (threadRootId: string): Promise<AgentE2e> => {
  let reader: ConversationReader | null = null;
  const e2e = await scope.start({
    chat: {
      fetchConversation: (read) => {
        if (reader == null) throw new Error('no history was set up');
        return reader(read);
      },
    },
  });
  reader = historiesFor(e2e.workspace.channel, threadRootId);
  return e2e;
};

const askForSummary = async (
  e2e: AgentE2e,
  options: { readonly messageId: string; readonly threadRootId: string },
): Promise<string> => {
  const outcome = await e2e.chat.deliver(
    mentionOn('slack', {
      text: `@growi agent ${SUMMARY_REQUEST}`,
      channel: e2e.workspace.channel,
      actor: e2e.workspace.actor,
      ...options,
    }),
  );
  expect(outcome).toEqual({ handled: true });
  expect(agentRequestsTo(e2e.growi)).toEqual([
    expect.objectContaining({ kind: 'agent', text: SUMMARY_REQUEST }),
  ]);
  return requestIdOf(e2e.growi);
};

describe('a conversation summarised into a page (Requirements 5.7, 5.8, 15.7)', () => {
  it('hands GROWI the thread the request was made in, and shows the requester where the page is', async () => {
    expect(levelOf('ephemeralMessage', 'slack')).toBe('full');
    const threadRootId = `T-${randomUUID()}`;
    const messageId = `M-${randomUUID()}`;
    const e2e = await startWithHistories(threadRootId);

    const requestId = await askForSummary(e2e, { messageId, threadRootId });
    // Nothing is read until GROWI asks for it.
    expect(e2e.chat.conversationReads()).toEqual([]);

    const conversation = await e2e.growi.requestConversation(e2e.proxyBaseUrl, {
      relationId: e2e.relationId,
      requestId,
    });

    expect(e2e.chat.conversationReads()).toEqual<CapturedConversationRead[]>([
      {
        target: e2e.workspace.channel,
        range: { threadRootId, requestMessageId: messageId, limit: 200 },
        installationId: e2e.workspace.installationId,
      },
    ]);
    expect(conversation.status).toBe(200);
    expect(conversation.parsed).toEqual({
      ok: true,
      messages: [
        {
          postedAt: '2026-11-16T08:00:00.000Z',
          author: bob,
          markdown: 'which day do we ship?',
        },
        {
          postedAt: '2026-11-16T08:10:00.000Z',
          author: bob,
          // Cut to the protocol's 20,000 characters, and marked as cut.
          markdown: `${'z'.repeat(19_999)}…`,
        },
      ],
      range: {
        messageCount: 2,
        firstPostedAt: '2026-11-16T08:00:00.000Z',
        lastPostedAt: '2026-11-16T08:10:00.000Z',
      },
      truncated: false,
    });
    if (!('ok' in conversation.parsed) || !conversation.parsed.ok) {
      throw new Error('GROWI could not read the conversation');
    }

    const answered = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, {
      relationId: e2e.relationId,
      requestId,
      answer: {
        kind: 'page-created',
        pageUrl: PAGE_URL,
        range: conversation.parsed.range,
        truncated: conversation.parsed.truncated,
      },
    });

    expect(answered.parsed).toEqual({ status: 'delivered' });
    // To the requester alone, in the thread the summary was asked in.
    expect(e2e.chat.posts()).toEqual([
      {
        kind: 'ephemeral',
        channel: e2e.workspace.channel,
        user: e2e.workspace.actor,
        threadRootId,
        message: {
          kind: 'markdown',
          markdown: [
            ANSWER_HEADER,
            '',
            `会話を要約したページを作りました: <${PAGE_URL}>`,
            '要約した範囲: 2026-11-16 08:00 UTC から 2026-11-16 08:10 UTC、2 件',
          ].join('\n'),
        },
      },
    ]);
  });

  it('refuses a conversation request that is unsigned or signed with a key it does not trust, and reads nothing', async () => {
    const threadRootId = `T-${randomUUID()}`;
    const e2e = await startWithHistories(threadRootId);
    const requestId = await askForSummary(e2e, {
      messageId: `M-${randomUUID()}`,
      threadRootId,
    });
    const request = { relationId: e2e.relationId, requestId };

    const unsigned = await fetch(
      `${e2e.proxyBaseUrl}${OP_ENDPOINTS[OP_NAMES.conversation].pathTemplate.replace('{proxyUri}', '')}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, op: OP_NAMES.conversation }),
      },
    );
    const impostor = await startFakeGrowi();
    onTestFinished(() => impostor.close());
    const forged = await impostor.requestConversation(
      e2e.proxyBaseUrl,
      request,
    );

    expect(unsigned.status).toBe(401);
    expect(await unsigned.text()).not.toContain('which day');
    expect(forged.status).toBe(401);
    expect(JSON.stringify(forged.body)).not.toContain('which day');
    expect(e2e.chat.conversationReads()).toEqual([]);
  });
});
