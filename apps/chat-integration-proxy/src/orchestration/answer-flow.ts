// `AnswerFlow` -- delivering the answer GROWI sends some time after an `agent`
// request, to the place and the person the request's record names
// (design.md's AnswerFlow). Why the destination comes from the record and not
// from GROWI: research.md, 「答えの宛先は proxy が覚える」.
import type { CommandAnswerRequest, CommandAnswerResult } from '@growi/chat';

import { CONTINUE_PLACE, supports } from '../capabilities/index.js';
import type { PrivateReplier, PrivateReplyOrigin } from '../command/index.js';
import type {
  PendingAgentRequestRecord,
  PendingAgentRequestRepository,
  StoredAnswerOrigin,
} from '../db/index.js';
import type { PlatformFacade } from '../platform/index.js';
import type { OutboundMessage } from '../types/index.js';
import { agentAnswerMessage } from './agent-answer-message.js';

export interface AnswerFlow {
  deliver(request: CommandAnswerRequest): Promise<CommandAnswerResult>;
}

export interface AnswerFlowDeps {
  readonly pendingAgentRequests: Pick<
    PendingAgentRequestRepository,
    'find' | 'claimDelivery' | 'recordDeliveryResult'
  >;
  readonly privateReplier: Pick<PrivateReplier, 'reply'>;
  readonly platform: Pick<PlatformFacade, 'post' | 'postInThread'>;
  /**
   * Where a DM answer that could not be posted is noted for the operator
   * (umbrella Requirement 1.12); a channel answer is noted by the replier.
   */
  readonly reportOperationalFailure: (message: string) => void;
  readonly now?: () => Date;
}

/**
 * How old a `delivering` mark must be before another delivery may take it
 * over (design.md AnswerFlow, `ANSWER_DELIVERY_RECLAIM_MS`).
 */
const ANSWER_DELIVERY_RECLAIM_MS = 2 * 60 * 1000;

type DeliveryResult = 'delivered' | 'undeliverable';

/**
 * The thread a channel answer is shown in: the request's own thread, else --
 * only where the service is known to show a private message in a thread nobody
 * has replied to -- the thread the request message starts. `null` is the
 * channel level.
 */
export const channelAnswerRootOf = (
  origin: StoredAnswerOrigin,
  showsInUnrepliedThread: boolean,
): string | null =>
  origin.threadRootId ??
  (showsInUnrepliedThread ? origin.sourceMessageId : null);

/** The answer that needs no delivery attempt, or `null` when one is due. */
const resultWithoutDelivering = (
  record: PendingAgentRequestRecord | null,
  now: Date,
): CommandAnswerResult['status'] | null => {
  // Past its expiry the record only waits for the sweep (research.md,
  // 「答えの宛先は proxy が覚える」 Follow-up).
  if (record == null || record.expiresAt <= now) return 'unknown-request';
  if (
    record.deliveryStatus === 'delivered' ||
    record.deliveryStatus === 'undeliverable'
  ) {
    return record.deliveryStatus;
  }
  return null;
};

const privateReplyOriginOf = (
  record: PendingAgentRequestRecord,
): PrivateReplyOrigin => {
  const { origin } = record;
  return {
    channel: origin.channel,
    actor: origin.actor,
    sourceMessageId: origin.sourceMessageId,
    requestSummary: origin.requestSummary,
    installationId: record.installationId,
    threadRootId: origin.threadRootId,
    replyThreadRootId: origin.replyThreadRootId,
    place: origin.place,
  };
};

export const createAnswerFlow = (deps: AnswerFlowDeps): AnswerFlow => {
  const {
    pendingAgentRequests,
    privateReplier,
    platform,
    reportOperationalFailure,
    now = () => new Date(),
  } = deps;

  const deliverTo = async (
    record: PendingAgentRequestRecord,
    message: OutboundMessage,
  ): Promise<DeliveryResult> => {
    const { origin, installationId } = record;
    if (origin.place === 'direct') {
      // Only the requester reads their DM, so a plain post is private enough.
      const scope = { installationId };
      const posted =
        origin.replyThreadRootId == null
          ? await platform.post(origin.channel, message, scope)
          : await platform.postInThread(
              origin.channel,
              origin.replyThreadRootId,
              message,
              scope,
            );
      if (posted.ok) return 'delivered';
      // The reason only: `detail` is the service's own text.
      reportOperationalFailure(
        `agent answer for request ${record.requestId} could not be posted in the ${origin.channel.platform} DM ${origin.channel.channelId}: ${posted.reason}`,
      );
      return 'undeliverable';
    }
    const replied = await privateReplier.reply(
      privateReplyOriginOf(record),
      message,
      {
        threadRootId: channelAnswerRootOf(
          origin,
          supports('ephemeral-in-unreplied-thread', origin.channel.platform),
        ),
      },
    );
    return replied.kind === 'undeliverable' ? 'undeliverable' : 'delivered';
  };

  return {
    async deliver({ relationId, requestId, answer }) {
      const at = now();
      const record = await pendingAgentRequests.find(relationId, requestId);
      const settled = resultWithoutDelivering(record, at);
      if (settled != null || record == null) {
        return { status: settled ?? 'unknown-request' };
      }

      const claimed = await pendingAgentRequests.claimDelivery(
        relationId,
        requestId,
        at,
        new Date(at.getTime() - ANSWER_DELIVERY_RECLAIM_MS),
      );
      if (!claimed) {
        // Read again: the delivery that holds the claim may have finished in
        // between, and then its result is the answer rather than a retry.
        const current = await pendingAgentRequests.find(relationId, requestId);
        return {
          status: resultWithoutDelivering(current, at) ?? 'in-progress',
        };
      }

      const message = agentAnswerMessage(answer, {
        place: record.origin.place,
        continuePlace: CONTINUE_PLACE[record.origin.channel.platform],
      });
      const status = await deliverTo(record, message);
      await pendingAgentRequests.recordDeliveryResult(
        relationId,
        requestId,
        at,
        status,
      );
      return { status };
    },
  };
};
