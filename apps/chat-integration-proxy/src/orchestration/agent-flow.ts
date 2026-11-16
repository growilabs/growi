// `AgentFlow` -- taking an `agent` request over from `command-flow` once the
// GROWI it goes to is chosen, and handling GROWI's immediate answer
// (design.md's AgentFlow). The answer itself arrives later, through the
// answer flow, addressed by the record this flow saves.
import { COMMAND_NAMES, type CommandRequest, OP_NAMES } from '@growi/chat';

import { toProtocolChannelRef } from '../capabilities/index.js';
import type { PrivateReplier, PrivateReplyOrigin } from '../command/index.js';
import type {
  PendingAgentRequestRepository,
  StoredAnswerOrigin,
} from '../db/index.js';
import type { GrowiClient } from '../growi/index.js';
import type { PlatformFacade } from '../platform/index.js';
import type { OutboundMessage } from '../types/index.js';
import type { AgentEntry } from './command-flow.js';
import {
  accountLinkNotice,
  markdown,
  notDeliveredNotice,
  notUsableNotice,
  refusedNotice,
  unexpectedAnswerNotice,
} from './growi-reply-wording.js';

export interface AgentFlowDeps {
  readonly growiClient: Pick<GrowiClient, 'sendCommand'>;
  readonly pendingAgentRequests: Pick<
    PendingAgentRequestRepository,
    'create' | 'delete'
  >;
  readonly privateReplier: PrivateReplier;
  readonly platform: Pick<PlatformFacade, 'setProcessingStatus'>;
  /** Where a request GROWI did not answer in time is noted for the operator. */
  readonly reportOperationalFailure: (message: string) => void;
  readonly newRequestId?: () => string;
  readonly now?: () => Date;
}

// The protocol's bounds on an `agent` request (design.md CommandVocabulary).
// `@growi/chat` keeps its own copies private; `agent-flow.spec.ts` pins these
// against its parser.
const AGENT_TEXT_MAX = 8000;
const CONVERSATION_KEY_MAX = 256;

/** design.md PendingAgentRequestRepository: 「受け付けから 24 時間」. */
const PENDING_AGENT_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

const tooLongNotice = markdown(
  `依頼の文章が長すぎます。${AGENT_TEXT_MAX} 文字以内に縮めて、もう一度依頼してください。`,
);

const lateAnswerNotice = (growiLabel: string) =>
  markdown(
    `GROWI「${growiLabel}」から、受け付けの返事が時間内に届きませんでした。依頼が受け付けられていれば、答えが後から届くことがあります。`,
  );

const storedOriginOf = (origin: PrivateReplyOrigin): StoredAnswerOrigin => ({
  channel: origin.channel,
  actor: origin.actor,
  sourceMessageId: origin.sourceMessageId,
  threadRootId: origin.threadRootId ?? null,
  replyThreadRootId: origin.replyThreadRootId ?? null,
  place: origin.place ?? 'channel',
  requestSummary: origin.requestSummary,
});

export const createAgentFlow = (deps: AgentFlowDeps): AgentEntry => {
  const {
    growiClient,
    pendingAgentRequests,
    privateReplier,
    platform,
    reportOperationalFailure,
    newRequestId = () => crypto.randomUUID(),
    now = () => new Date(),
  } = deps;

  return async ({ invocation, origin, relation, text, conversationKey }) => {
    const tell = async (message: OutboundMessage): Promise<void> => {
      await privateReplier.reply(origin, message);
    };

    if (text.length > AGENT_TEXT_MAX) {
      await tell(tooLongNotice);
      return;
    }
    // The key is built from chat-side ids, not typed by the user, so a key
    // over the bound is this place being unusable rather than a long request.
    if (conversationKey.length > CONVERSATION_KEY_MAX) {
      await tell(notUsableNotice(invocation.commandName));
      return;
    }

    const requestId = newRequestId();
    const stored = storedOriginOf(origin);
    // Saved before sending: the answer could otherwise arrive with nowhere to go.
    await pendingAgentRequests.create({
      relationId: relation.relationId,
      requestId,
      installationId: relation.installationId,
      origin: stored,
      expiresAt: new Date(now().getTime() + PENDING_AGENT_REQUEST_TTL_MS),
    });

    await privateReplier.acknowledge(
      origin,
      markdown(`GROWI「${relation.growiLabel}」に依頼しています…`),
    );
    // Only a DM: Slack's assistant thread, where the status shows, is DM-only.
    if (stored.place === 'direct' && stored.replyThreadRootId != null) {
      await platform.setProcessingStatus(
        origin.channel,
        stored.replyThreadRootId,
        { installationId: relation.installationId },
      );
    }

    const request: CommandRequest = {
      op: OP_NAMES.command,
      relationId: relation.relationId,
      requestId,
      actor: invocation.actor,
      channel: toProtocolChannelRef(invocation.channel),
      kind: COMMAND_NAMES.agent,
      text,
      conversationKey,
    };
    const sent = await growiClient.sendCommand(relation.growiUri, request);

    if (!sent.ok && sent.reason === 'unreachable') {
      // Includes the wait cap running out, after which GROWI may still have
      // accepted it -- so the record stays (design.md AgentFlow).
      reportOperationalFailure(
        `agent request ${requestId} for relation ${relation.relationId}: GROWI did not answer; the pending request is kept until it expires.`,
      );
      await tell(lateAnswerNotice(relation.growiLabel));
      return;
    }
    if (sent.ok && sent.response.kind === 'accepted') return;

    await pendingAgentRequests.delete(relation.relationId, requestId);
    if (!sent.ok) {
      await tell(notDeliveredNotice(relation.growiLabel));
      return;
    }
    const { response } = sent;
    switch (response.kind) {
      case 'account-link-required':
        await tell(accountLinkNotice(response.growiLabel, response.linkUrl));
        return;
      case 'error':
        await tell(refusedNotice(relation.growiLabel, response.message));
        return;
      default:
        await tell(unexpectedAnswerNotice(relation.growiLabel));
    }
  };
};
