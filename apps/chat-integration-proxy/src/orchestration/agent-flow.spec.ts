import {
  COMMAND_NAMES,
  type CommandRequest,
  type CommandResponse,
  OP_NAMES,
  parseCommandRequest,
  toNativeChannelId,
} from '@growi/chat';
import { describe, expect, it } from 'vitest';

import { testSdkChannel } from '../capabilities/test-channels.js';
import {
  type PrivateReplier,
  type PrivateReplyOrigin,
  privateReplyOriginOf,
} from '../command/index.js';
import type {
  NewPendingAgentRequest,
  PendingAgentRequestRecord,
} from '../db/index.js';
import type { GrowiCallResult } from '../growi/index.js';
import type {
  Invocation,
  OutboundMessage,
  Relation,
  SdkChannelRef,
} from '../types/index.js';
import { type AgentFlowDeps, createAgentFlow } from './agent-flow.js';
import type { AgentRequestInput } from './command-flow.js';

const NOW = new Date('2026-11-16T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const channel = testSdkChannel('slack');
const directMessage = testSdkChannel('slack', { isDirectMessage: true });
const actor = {
  platform: 'slack' as const,
  accountId: 'U1',
  displayName: 'Taro',
};

const RELATION: Relation = {
  relationId: 'rel-a',
  installationId: 'inst-of-relation',
  growiUri: 'https://growi-a.example.com/',
  growiLabel: 'Wiki',
  searchWeight: 1,
  settingsVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const invocationOn = (
  place: SdkChannelRef,
  overrides: Partial<Invocation> = {},
): Invocation => ({
  platform: 'slack',
  channel: place,
  actor,
  commandName: COMMAND_NAMES.agent,
  argsText: 'what is our onboarding process?',
  interaction: null,
  sourceMessageId: 'M-1',
  ...overrides,
});

const inputOf = (
  invocation: Invocation,
  overrides: Partial<AgentRequestInput> = {},
): AgentRequestInput => ({
  invocation,
  origin: privateReplyOriginOf(invocation, 'inst-of-event'),
  relation: RELATION,
  text: 'what is our onboarding process?',
  conversationKey: 'slack:C1:M-1',
  ...overrides,
});

const textOf = (message: OutboundMessage): string =>
  message.kind === 'markdown' ? message.markdown : JSON.stringify(message);

/**
 * Everything the flow touches, kept as plain records: what was stored, what
 * was sent to GROWI, and what the requester was told.
 */
const harness = (
  answer: GrowiCallResult<CommandResponse> = {
    ok: true,
    response: { kind: 'accepted' },
  },
  options: { readonly deleteThrows?: boolean } = {},
) => {
  const stored = new Map<string, PendingAgentRequestRecord>();
  const sent: Array<{
    readonly request: CommandRequest;
    readonly storedAtSend: ReadonlyArray<string>;
  }> = [];
  const replies: Array<{ origin: PrivateReplyOrigin; text: string }> = [];
  const acknowledged: Array<{ origin: PrivateReplyOrigin; fallback: string }> =
    [];
  const statuses: Array<{
    channel: SdkChannelRef;
    threadRootId: string;
    installationId: string;
  }> = [];
  const reports: string[] = [];
  const calls: string[] = [];

  const privateReplier: PrivateReplier = {
    reply: (origin, message) => {
      replies.push({ origin, text: textOf(message) });
      return Promise.resolve({ kind: 'in-place' });
    },
    acknowledge: (origin, fallback) => {
      calls.push('acknowledge');
      acknowledged.push({ origin, fallback: textOf(fallback) });
      return Promise.resolve();
    },
  };

  const deps: AgentFlowDeps = {
    growiClient: {
      sendCommand: (_growiUri, request) => {
        calls.push('send');
        sent.push({ request, storedAtSend: [...stored.keys()] });
        return Promise.resolve(answer);
      },
    },
    pendingAgentRequests: {
      create: (request: NewPendingAgentRequest) => {
        const record: PendingAgentRequestRecord = {
          ...request,
          deliveryStatus: null,
          deliveryClaimedAt: null,
        };
        stored.set(`${request.relationId}/${request.requestId}`, record);
        return Promise.resolve(record);
      },
      delete: (relationId, requestId) => {
        if (options.deleteThrows) {
          return Promise.reject(new Error('database unavailable'));
        }
        return Promise.resolve(
          stored.delete(`${relationId}/${requestId}`) ? 1 : 0,
        );
      },
    },
    privateReplier,
    platform: {
      setProcessingStatus: (target, threadRootId, scope) => {
        statuses.push({
          channel: target,
          threadRootId,
          installationId: scope.installationId,
        });
        return Promise.resolve();
      },
    },
    reportOperationalFailure: (message) => {
      reports.push(message);
    },
    newRequestId: () => 'req-1',
    now: () => NOW,
  };

  return {
    entry: createAgentFlow(deps),
    stored: () => [...stored.values()],
    sent: () => [...sent],
    replies: () => [...replies],
    acknowledged: () => [...acknowledged],
    statuses: () => [...statuses],
    reports: () => [...reports],
    calls: () => [...calls],
  };
};

describe('sending an agent request (Requirement 15.1)', () => {
  it('sends the text and the conversation key to the chosen GROWI as an agent command, under the id it recorded', async () => {
    const flow = harness();

    await flow.entry(inputOf(invocationOn(channel)));

    const [only] = flow.sent();
    expect(only?.request).toEqual({
      op: OP_NAMES.command,
      relationId: RELATION.relationId,
      requestId: 'req-1',
      actor,
      channel: {
        platform: 'slack',
        channelId: toNativeChannelId('C1'),
        channelName: channel.channelName,
        isPrivate: false,
      },
      kind: COMMAND_NAMES.agent,
      text: 'what is our onboarding process?',
      conversationKey: 'slack:C1:M-1',
    });
    expect(flow.stored().map((record) => record.requestId)).toEqual(['req-1']);
  });

  it('records the request before sending it, so an early answer finds where to go', async () => {
    const flow = harness();

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.sent()[0]?.storedAtSend).toEqual([
      `${RELATION.relationId}/req-1`,
    ]);
  });
});

describe('what is recorded for the answer', () => {
  it("keeps the relation's installation, a 24-hour expiry, and reads a request with no place or roots as a channel request with none", async () => {
    const flow = harness();
    // A request from a modal carries no roots and no place.
    const invocation = invocationOn(channel, { sourceMessageId: null });

    await flow.entry(inputOf(invocation, { conversationKey: 'slack:C1:x' }));

    expect(flow.stored()).toEqual([
      {
        relationId: RELATION.relationId,
        requestId: 'req-1',
        installationId: RELATION.installationId,
        origin: {
          channel,
          actor,
          sourceMessageId: null,
          threadRootId: null,
          replyThreadRootId: null,
          place: 'channel',
          requestSummary: 'agent what is our onboarding process?',
        },
        deliveryStatus: null,
        deliveryClaimedAt: null,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
      },
    ]);
  });

  it('keeps both roots and the DM place the request carried', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(
        invocationOn(directMessage, {
          threadRootId: 'T-read',
          replyThreadRootId: 'T-reply',
          isDirectMessage: true,
        }),
      ),
    );

    expect(flow.stored()[0]?.origin).toMatchObject({
      threadRootId: 'T-read',
      replyThreadRootId: 'T-reply',
      place: 'direct',
      sourceMessageId: 'M-1',
    });
  });
});

describe('showing the request was received (Requirements 15.5, 15.16)', () => {
  it('acknowledges the request without its content', async () => {
    const flow = harness();
    const input = inputOf(invocationOn(channel));

    await flow.entry(input);

    expect(flow.acknowledged()).toEqual([
      { origin: input.origin, fallback: expect.stringContaining('Wiki') },
    ]);
    expect(flow.acknowledged()[0]?.fallback).not.toContain('onboarding');
  });

  it('shows the request was received before sending it to GROWI', async () => {
    const flow = harness();

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.calls()).toEqual(['acknowledge', 'send']);
  });

  it('shows the processing status in a DM, on the thread the answer will go to, as the installation the request belongs to', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(
        invocationOn(directMessage, {
          replyThreadRootId: 'M-1',
          isDirectMessage: true,
        }),
      ),
    );

    expect(flow.statuses()).toEqual([
      {
        channel: directMessage,
        threadRootId: 'M-1',
        installationId: RELATION.installationId,
      },
    ]);
  });

  it('shows no processing status in a channel, even inside a thread', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(
        invocationOn(channel, {
          threadRootId: 'T-1',
          replyThreadRootId: 'T-1',
          isDirectMessage: false,
        }),
      ),
    );

    expect(flow.statuses()).toEqual([]);
  });

  it('shows no processing status in a DM that has no thread to put it on', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(
        invocationOn(directMessage, {
          replyThreadRootId: null,
          isDirectMessage: true,
        }),
      ),
    );

    expect(flow.statuses()).toEqual([]);
  });
});

describe("GROWI's answer", () => {
  it('ends with the record kept and nothing more said when GROWI accepted', async () => {
    const flow = harness({ ok: true, response: { kind: 'accepted' } });

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.stored()).toHaveLength(1);
    expect(flow.replies()).toEqual([]);
  });

  it('drops the record and sends the link instructions when GROWI asks for an account link (Requirement 15.3)', async () => {
    const flow = harness({
      ok: true,
      response: {
        kind: 'account-link-required',
        growiLabel: 'Wiki',
        linkUrl: 'https://growi-a.example.com/link/abc',
      },
    });

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.stored()).toEqual([]);
    expect(flow.replies().map((reply) => reply.text)).toEqual([
      expect.stringContaining('<https://growi-a.example.com/link/abc>'),
    ]);
  });

  it.each([
    ['ai-unavailable', 'GROWI の AI が有効になっていません。'],
    ['busy', '前の依頼を処理しています。'],
  ] as const)('drops the record and passes on the reason when GROWI refuses with %s (Requirements 15.4, 15.12)', async (code, message) => {
    const flow = harness({
      ok: true,
      response: { kind: 'error', code, message },
    });

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.stored()).toEqual([]);
    expect(flow.replies().map((reply) => reply.text)).toEqual([
      `GROWI「Wiki」で実行できませんでした: ${message}`,
    ]);
  });

  it('still tells the requester when the record cannot be dropped', async () => {
    const flow = harness(
      {
        ok: true,
        response: {
          kind: 'error',
          code: 'busy',
          message: '前の依頼を処理しています。',
        },
      },
      { deleteThrows: true },
    );

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.replies().map((reply) => reply.text)).toEqual([
      'GROWI「Wiki」で実行できませんでした: 前の依頼を処理しています。',
    ]);
  });

  it('drops the record when GROWI answers with something that is not an answer to agent', async () => {
    const flow = harness({
      ok: true,
      response: { kind: 'created', pageUrl: 'https://growi-a.example.com/x' },
    });

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.stored()).toEqual([]);
    expect(flow.replies().map((reply) => reply.text)).toEqual([
      'GROWI「Wiki」から想定外の応答が返りました。',
    ]);
  });

  it('keeps the record, says the answer may still come, and notes it for the operator when GROWI did not answer', async () => {
    const flow = harness({ ok: false, reason: 'unreachable' });

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.stored()).toHaveLength(1);
    expect(flow.replies().map((reply) => reply.text)).toEqual([
      'GROWI「Wiki」から、受け付けの返事が時間内に届きませんでした。依頼が受け付けられていれば、答えが後から届くことがあります。',
    ]);
    expect(flow.reports()).toEqual([
      expect.stringMatching(/rel-a.*req-1|req-1.*rel-a/),
    ]);
  });

  it.each([
    'uri-refused',
    'no-signing-key',
    'http-error',
    'malformed-response',
  ] as const)('drops the record and says the request did not reach GROWI when the call failed with %s', async (reason) => {
    const flow = harness({ ok: false, reason });

    await flow.entry(inputOf(invocationOn(channel)));

    expect(flow.stored()).toEqual([]);
    expect(flow.replies().map((reply) => reply.text)).toEqual([
      'GROWI「Wiki」に届きませんでした。',
    ]);
    expect(flow.reports()).toEqual([]);
  });
});

describe('a request the protocol would refuse', () => {
  const AGENT_TEXT_MAX = 8000;
  const CONVERSATION_KEY_MAX = 256;

  it('tells the requester the request is too long, and records and sends nothing', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(invocationOn(channel), { text: 'a'.repeat(AGENT_TEXT_MAX + 1) }),
    );

    expect(flow.replies().map((reply) => reply.text)).toEqual([
      '依頼の文章が長すぎます。8000 文字以内に縮めて、もう一度依頼してください。',
    ]);
    expect(flow.stored()).toEqual([]);
    expect(flow.sent()).toEqual([]);
    expect(flow.acknowledged()).toEqual([]);
  });

  it('sends a request exactly at the limit', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(invocationOn(channel), { text: 'a'.repeat(AGENT_TEXT_MAX) }),
    );

    expect(flow.sent()).toHaveLength(1);
  });

  it('sends a request whose conversation key is exactly at the limit', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(invocationOn(channel), {
        conversationKey: 'k'.repeat(CONVERSATION_KEY_MAX),
      }),
    );

    expect(flow.sent()).toHaveLength(1);
  });

  it('answers that agent cannot be used here, and records and sends nothing, when the conversation key is too long', async () => {
    const flow = harness();

    await flow.entry(
      inputOf(invocationOn(channel), {
        conversationKey: 'k'.repeat(CONVERSATION_KEY_MAX + 1),
      }),
    );

    expect(flow.replies().map((reply) => reply.text)).toEqual([
      '`agent` は今使えません。',
    ]);
    expect(flow.stored()).toEqual([]);
    expect(flow.sent()).toEqual([]);
  });

  it('checks the same limits the protocol parser enforces', () => {
    const requestWith = (text: string, conversationKey: string) => ({
      op: OP_NAMES.command,
      relationId: 'rel-a',
      requestId: 'req-1',
      actor,
      channel: { ...channel, channelId: toNativeChannelId('C1') },
      kind: COMMAND_NAMES.agent,
      text,
      conversationKey,
    });
    const accepted = (text: string, conversationKey: string) =>
      !('error' in parseCommandRequest(requestWith(text, conversationKey)));

    expect(accepted('a'.repeat(AGENT_TEXT_MAX), 'k')).toBe(true);
    expect(accepted('a'.repeat(AGENT_TEXT_MAX + 1), 'k')).toBe(false);
    expect(accepted('a', 'k'.repeat(CONVERSATION_KEY_MAX))).toBe(true);
    expect(accepted('a', 'k'.repeat(CONVERSATION_KEY_MAX + 1))).toBe(false);
  });
});
