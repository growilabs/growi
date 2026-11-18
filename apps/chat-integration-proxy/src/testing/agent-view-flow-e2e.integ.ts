// The `agent` flow in Slack's AI app view: text typed in the DM
// with the bot is an `agent` request whatever its first word. The DM shows a
// processing indicator, the answer arrives in the same thread, and every
// request in one thread carries the same conversation key, so GROWI can
// continue the conversation (Requirements 15.14, 15.15, 15.16).
//
// The AI app view is switched on by handing the proxy the setting
// (`agentView`), exactly what `SLACK_AGENT_VIEW` becomes in `loadConfig`. The
// rest of the setup is `agent-e2e-fixture.ts`'s; see
// `agent-channel-flow-e2e.integ.ts` for what this kind of suite asserts.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { nativeChannelIdOf } from '../capabilities/index.js';
import {
  type AgentE2e,
  ANSWER_HEADER,
  agentE2eScope,
  agentRequestsTo,
  requestIdOf,
} from './agent-e2e-fixture.js';
import { mentionOn } from './chat-events.js';
import type { CapturedPost } from './fake-chat-service.js';

const scope = agentE2eScope();
afterEach(() => scope.close());

/** Types `text` in the DM with the bot, in a thread or starting one. */
const typeInDirectMessage = async (
  e2e: AgentE2e,
  text: string,
  options: { readonly messageId: string; readonly threadRootId?: string },
): Promise<void> => {
  const outcome = await e2e.chat.deliver(
    mentionOn('slack', {
      text,
      channel: e2e.directChannel,
      actor: e2e.workspace.actor,
      inDirectMessage: true,
      installation: e2e.installation,
      ...options,
    }),
  );
  expect(outcome).toEqual({ handled: true });
};

const keyOf = (e2e: AgentE2e, threadRootId: string): string =>
  `slack:${nativeChannelIdOf(e2e.directChannel)}:${threadRootId}`;

const answerInThread = (
  e2e: AgentE2e,
  threadRootId: string,
  markdown: string,
): CapturedPost => ({
  kind: 'thread-post',
  channel: e2e.directChannel,
  threadRootId,
  installationId: e2e.workspace.installationId,
  // No "carry on in the DM" notice: the reader is already there.
  message: { kind: 'markdown', markdown: `${ANSWER_HEADER}\n\n${markdown}` },
});

describe('the Slack AI app view (Requirements 15.14, 15.15, 15.16)', () => {
  it('answers free text in the thread it was typed in, and keeps one conversation per thread', async () => {
    const e2e = await scope.start({ agentView: true });
    const firstId = `M-${randomUUID()}`;

    // Starts with a command word on purpose: here it is still an `agent`
    // request, sent whole.
    await typeInDirectMessage(e2e, 'search for the release notes of v8', {
      messageId: firstId,
    });

    expect(e2e.chat.processingStatuses()).toEqual([
      {
        channel: e2e.directChannel,
        threadRootId: firstId,
        installationId: e2e.workspace.installationId,
      },
    ]);
    expect(e2e.growi.refusals()).toEqual([]);
    expect(e2e.growi.received().map((request) => request.body)).toEqual([
      expect.objectContaining({
        kind: 'agent',
        text: 'search for the release notes of v8',
        conversationKey: keyOf(e2e, firstId),
      }),
    ]);
    expect(e2e.chat.posts()).toEqual([]);

    const first = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, {
      relationId: e2e.relationId,
      requestId: requestIdOf(e2e.growi, 0),
      answer: { kind: 'text', markdown: 'v8 ships on Friday.', sources: [] },
    });
    expect(first.parsed).toEqual({ status: 'delivered' });
    expect(e2e.chat.posts()).toEqual([
      answerInThread(e2e, firstId, 'v8 ships on Friday.'),
    ]);

    // A follow-up in the same thread: the same conversation, answered there.
    await typeInDirectMessage(e2e, 'and who approved it?', {
      messageId: `M-${randomUUID()}`,
      threadRootId: firstId,
    });
    const followUp = await e2e.growi.sendCommandAnswer(e2e.proxyBaseUrl, {
      relationId: e2e.relationId,
      requestId: requestIdOf(e2e.growi, 1),
      answer: { kind: 'text', markdown: 'Ada approved it.', sources: [] },
    });
    expect(followUp.parsed).toEqual({ status: 'delivered' });

    // A new thread: a new conversation.
    const otherId = `M-${randomUUID()}`;
    await typeInDirectMessage(e2e, 'what is on the agenda tomorrow?', {
      messageId: otherId,
    });

    expect(
      agentRequestsTo(e2e.growi).map((request) => request.conversationKey),
    ).toEqual([keyOf(e2e, firstId), keyOf(e2e, firstId), keyOf(e2e, otherId)]);
    expect(
      e2e.chat.processingStatuses().map((status) => status.threadRootId),
    ).toEqual([firstId, firstId, otherId]);
    expect(e2e.chat.posts()).toEqual([
      answerInThread(e2e, firstId, 'v8 ships on Friday.'),
      answerInThread(e2e, firstId, 'Ada approved it.'),
    ]);
  });

  it('sends nothing to GROWI for free text in an ordinary DM, where the AI app view is off', async () => {
    const e2e = await scope.start();

    await typeInDirectMessage(e2e, 'what did we decide about the release?', {
      messageId: `M-${randomUUID()}`,
    });

    expect(e2e.growi.received()).toEqual([]);
    expect(e2e.chat.processingStatuses()).toEqual([]);
  });
});
