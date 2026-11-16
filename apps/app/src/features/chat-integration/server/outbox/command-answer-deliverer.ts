// How ONE `command-answer` outbox row is sent (Requirements 15.6, 15.11).
// Claiming, backoff, giving up and removing the sent body belong to
// `outbox-dispatcher.ts`; which proxy answers end the row is design.md
// CommandAnswerContract.

import type { CommandAnswerResult } from '@growi/chat';

import loggerFactory from '~/utils/logger';

import { sendCommandAnswer } from '../proxy-client';
import type { Deliverer, DeliveryVerdict } from './outbox-dispatcher';

const logger = loggerFactory(
  'growi:features:chat-integration:command-answer-deliverer',
);

const FINAL_STATUSES: ReadonlySet<CommandAnswerResult['status']> = new Set([
  'delivered',
  'undeliverable',
  'unknown-request',
]);

export interface CommandAnswerDelivererDeps {
  /** Injection seam for tests; production uses `ProxyClient`'s own. */
  readonly sendCommandAnswer?: typeof sendCommandAnswer;
}

const failedWith = (failure: string): DeliveryVerdict => ({
  outcome: 'retry',
  result: { failure },
});

/**
 * Anything but a final status is an ordinary `retry` that counts toward
 * giving up -- `in-progress` included (design.md AnswerFlow: GROWI counts it),
 * so a proxy that keeps answering `in-progress` still ends in `given-up`.
 */
export const createCommandAnswerDeliverer = (
  deps: CommandAnswerDelivererDeps = {},
): Deliverer<'command-answer'> => {
  const send = deps.sendCommandAnswer ?? sendCommandAnswer;

  return async (row) => {
    const context = { relationId: row.relationId, requestId: row.requestId };
    if (row.answer == null) {
      logger.error(context, 'A command answer row has no answer to send');
      return failedWith('missing-answer');
    }

    let sent: Awaited<ReturnType<typeof sendCommandAnswer>>;
    try {
      sent = await send(row.relationId, {
        requestId: row.requestId,
        answer: row.answer,
      });
    } catch (err) {
      // Name and message only: an HTTP error object carries signed headers.
      const { name, message } =
        err instanceof Error ? err : { name: 'Error', message: String(err) };
      logger.error({ ...context, name, message }, 'Sending an answer threw');
      return failedWith('unexpected-error');
    }

    if (!sent.ok) {
      logger.warn(
        { ...context, reason: sent.reason },
        'A command answer could not be sent to the proxy',
      );
      return failedWith(sent.reason);
    }

    const { status } = sent.response;
    if (FINAL_STATUSES.has(status)) {
      return { outcome: 'sent', result: { status } };
    }
    return { outcome: 'retry', result: { status } };
  };
};
