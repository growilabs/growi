// The `agent` flow in a channel: someone asks `@GROWI agent
// <question>`, the proxy acknowledges it with a reaction and hands it to GROWI,
// and the answer GROWI sends later reaches that person alone (Requirements
// 15.1, 15.5, 15.7).
//
// Driven through a real `startProxy` boot against a real PostgreSQL; the chat
// service is the fake facade and GROWI is the fake GROWI, which both verifies
// what the proxy sends and signs what it sends back. What is asserted is what
// the chat user sees and what GROWI receives -- never how the proxy got there.
import { randomUUID } from 'node:crypto';
import { OP_ENDPOINTS, OP_NAMES } from '@growi/chat';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { levelOf, nativeChannelIdOf } from '../capabilities/index.js';
import {
  type AgentE2e,
  ANSWER_HEADER,
  agentE2eScope,
  agentRequestsTo,
  requestIdOf,
} from './agent-e2e-fixture.js';
import { mentionOn } from './chat-events.js';
import type { CapturedPost } from './fake-chat-service.js';
import { startFakeGrowi } from './fake-growi.js';

const scope = agentE2eScope();
afterEach(() => scope.close());

const QUESTION = 'when do we ship the release?';

const ANSWER = {
  kind: 'text',
  markdown: 'Ship on Friday.',
  sources: [{ title: 'Release plan', url: 'http://growi.test/release-plan' }],
} as const;

/** What the requester reads: the answer, its source, and where to carry on. */
const VISIBLE_ANSWER = [
  ANSWER_HEADER,
  'Ship on Friday.',
  '出典:\n- [Release plan](http://growi.test/release-plan)',
  'この続きは、bot との DM で聞けます。DM の同じスレッドで続けて依頼すると、それまでのやり取りを踏まえて答えます。',
].join('\n\n');

/** Asks the question in the workspace's channel, outside or inside a thread. */
const ask = async (
  e2e: AgentE2e,
  options: { readonly messageId: string; readonly threadRootId?: string },
): Promise<void> => {
  const outcome = await e2e.chat.deliver(
    mentionOn('slack', {
      text: `@growi agent ${QUESTION}`,
      channel: e2e.workspace.channel,
      actor: e2e.workspace.actor,
      ...options,
    }),
  );
  expect(outcome).toEqual({ handled: true });
};

const privateAnswer = (e2e: AgentE2e, threadRootId?: string): CapturedPost => ({
  kind: 'ephemeral',
  channel: e2e.workspace.channel,
  user: e2e.workspace.actor,
  ...(threadRootId == null ? {} : { threadRootId }),
  message: { kind: 'markdown', markdown: VISIBLE_ANSWER },
});

describe('an agent request made in a channel (Requirements 15.1, 15.5, 15.7)', () => {
  it('is acknowledged with a reaction, reaches GROWI, and its answer is shown to the requester alone, once', async () => {
    // Slack shows a message to one person in place, so the answer stays in
    // the channel rather than going to a DM.
    expect(levelOf('ephemeralMessage', 'slack')).toBe('full');
    const e2e = await scope.start();
    const messageId = `M-${randomUUID()}`;

    await ask(e2e, { messageId });

    expect(e2e.chat.reactions()).toEqual([
      {
        target: { channel: e2e.workspace.channel, messageId },
        reaction: 'eyes',
      },
    ]);
    // Accepted by GROWI: nothing is posted until the answer comes.
    expect(e2e.chat.posts()).toEqual([]);
    expect(e2e.growi.refusals()).toEqual([]);
    expect(agentRequestsTo(e2e.growi)).toEqual([
      expect.objectContaining({
        op: OP_NAMES.command,
        relationId: e2e.relationId,
        requestId: expect.any(String),
        kind: 'agent',
        text: QUESTION,
        conversationKey: `slack:${nativeChannelIdOf(e2e.workspace.channel)}:${messageId}`,
        actor: expect.objectContaining({
          accountId: e2e.workspace.actor.accountId,
        }),
      }),
    ]);

    const answer = {
      relationId: e2e.relationId,
      requestId: requestIdOf(e2e.growi),
      answer: ANSWER,
    };
    const first = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, answer);
    expect(first).toMatchObject({
      status: 200,
      parsed: { status: 'delivered' },
    });
    // Slack's private message in a thread nobody replied to is unverified, so
    // the answer to a request outside a thread is shown at the channel level.
    expect(e2e.chat.posts()).toEqual([privateAnswer(e2e)]);

    // GROWI's outbox sends again when it did not hear back: the stored result
    // is answered and nobody reads the answer twice.
    const repeat = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, answer);
    expect(repeat).toMatchObject({
      status: 200,
      parsed: { status: 'delivered' },
    });
    expect(e2e.chat.posts()).toEqual([privateAnswer(e2e)]);
  });

  it('shows the answer to a request made inside a thread in that thread, to the requester alone', async () => {
    const e2e = await scope.start();
    const threadRootId = `T-${randomUUID()}`;
    const messageId = `M-${randomUUID()}`;

    await ask(e2e, { messageId, threadRootId });
    // The conversation is the thread, wherever in it the request was made.
    expect(agentRequestsTo(e2e.growi)).toEqual([
      expect.objectContaining({
        conversationKey: `slack:${nativeChannelIdOf(e2e.workspace.channel)}:${threadRootId}`,
      }),
    ]);

    const delivered = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, {
      relationId: e2e.relationId,
      requestId: requestIdOf(e2e.growi),
      answer: ANSWER,
    });

    expect(delivered.parsed).toEqual({ status: 'delivered' });
    expect(e2e.chat.posts()).toEqual([privateAnswer(e2e, threadRootId)]);
  });

  it('refuses an answer that is unsigned or signed with a key it does not trust, posts nothing, and still delivers the genuine one', async () => {
    const e2e = await scope.start();
    await ask(e2e, { messageId: `M-${randomUUID()}` });
    const answer = {
      relationId: e2e.relationId,
      requestId: requestIdOf(e2e.growi),
      answer: ANSWER,
    };

    const unsigned = await fetch(
      `${e2e.proxyBaseUrl}${OP_ENDPOINTS[OP_NAMES.commandAnswer].pathTemplate.replace('{proxyUri}', '')}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...answer, op: OP_NAMES.commandAnswer }),
      },
    );
    // Same key id as the paired GROWI, different key: only the signature
    // itself can tell the two apart.
    const impostor = await startFakeGrowi();
    onTestFinished(() => impostor.close());
    const forged = await impostor.sendCommandAnswer(e2e.proxyBaseUrl, answer);

    expect(unsigned.status).toBe(401);
    expect(forged.status).toBe(401);
    expect(e2e.chat.posts()).toEqual([]);

    const genuine = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, answer);
    expect(genuine.parsed).toEqual({ status: 'delivered' });
    expect(e2e.chat.posts()).toEqual([privateAnswer(e2e)]);
  });

  it('answers `unknown-request` to an answer for a request it never sent, and posts nothing', async () => {
    const e2e = await scope.start();

    const answer = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, {
      relationId: e2e.relationId,
      requestId: randomUUID(),
      answer: ANSWER,
    });

    expect(answer).toMatchObject({
      status: 200,
      parsed: { status: 'unknown-request' },
    });
    expect(e2e.chat.posts()).toEqual([]);
  });
});
