// Closing `agent` requests whose run stopped (design.md RunAgentRequest): a
// row still running past the limit gets a `failed/timeout` answer and is
// finished, through the same store-then-finish step the run uses.

import loggerFactory from '~/utils/logger';

// Not the `../outbox` barrel: it loads the outbox cron, which imports this file.
import { chatOutbox } from '../outbox/chat-outbox';
import { failedAnswer } from './agent-answer';
import type { ChatAgentRequestModel } from './models/chat-agent-request';
import { ChatAgentRequest } from './models/chat-agent-request';
import {
  type AgentRequestIds,
  type RecordAgentAnswerDeps,
  recordAgentAnswer,
} from './record-agent-answer';

export type StaleAgentRequestSweep = (now: Date) => Promise<void>;

export interface SweepLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface StaleAgentRequestSweepDeps extends RecordAgentAnswerDeps {
  readonly requests: Pick<ChatAgentRequestModel, 'find' | 'updateOne'>;
  readonly logger: SweepLogger;
}

/** Past the 5-minute run limit, plus room for a run that overran it a little. */
export const STALE_AGENT_REQUEST_AFTER_MS = 7 * 60 * 1000;

/**
 * Rows handled per call, oldest first. Stale rows only come from a stopped
 * process and each user has at most one running row, so a page rarely fills;
 * the rest waits for the next 5-minute tick instead of stretching one tick.
 */
export const STALE_AGENT_REQUEST_PAGE_SIZE = 50;

const TIMEOUT = failedAnswer('timeout');

// The name only: a driver error message can quote the stored document.
const errorNameOf = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const sweepRow = async (
  deps: StaleAgentRequestSweepDeps,
  ids: AgentRequestIds,
): Promise<void> => {
  try {
    const recorded = await recordAgentAnswer(deps, ids, TIMEOUT);
    if (recorded.outcome === 'not-stored') {
      deps.logger.error(
        { ...ids, errorName: errorNameOf(recorded.error) },
        'The timeout answer of a stale agent request could not be stored; the next sweep retries',
      );
      return;
    }
    deps.logger.info(
      { ...ids, outcome: recorded.outcome },
      'Finished a stale agent request',
    );
  } catch (error) {
    deps.logger.error(
      { ...ids, errorName: errorNameOf(error) },
      'A stale agent request could not be finished; the next sweep retries',
    );
  }
};

/** Never rejects: a failed row or query is left for the next call. */
export const createStaleAgentRequestSweep =
  (deps: StaleAgentRequestSweepDeps): StaleAgentRequestSweep =>
  async (now) => {
    try {
      const stale: AgentRequestIds[] = await deps.requests
        .find(
          {
            state: 'running',
            startedAt: {
              $lt: new Date(now.getTime() - STALE_AGENT_REQUEST_AFTER_MS),
            },
          },
          { _id: 0, relationId: 1, requestId: 1 },
        )
        .sort({ startedAt: 1 })
        .limit(STALE_AGENT_REQUEST_PAGE_SIZE)
        .lean();
      for (const ids of stale) {
        // biome-ignore lint/performance/noAwaitInLoops: one row at a time keeps the per-tick load flat
        await sweepRow(deps, {
          relationId: ids.relationId,
          requestId: ids.requestId,
        });
      }
    } catch (error) {
      deps.logger.error(
        { errorName: errorNameOf(error) },
        'Stale agent requests could not be read; the next sweep retries',
      );
    }
  };

let productionSweep: StaleAgentRequestSweep | undefined;

/**
 * The sweep the outbox cron runs. Built on the first call, so module load
 * order never matters; it loads no part of GROWI's AI.
 */
export const sweepStaleAgentRequests: StaleAgentRequestSweep = (now) => {
  productionSweep ??= createStaleAgentRequestSweep({
    requests: ChatAgentRequest,
    outbox: chatOutbox,
    logger: loggerFactory(
      'growi:features:chat-integration:sweep-stale-agent-requests',
    ),
  });
  return productionSweep(now);
};
