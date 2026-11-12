import type { ModelKey } from '~/features/mastra/interfaces/model-key';
import loggerFactory from '~/utils/logger';

import type { AiUsageFeature } from '../../interfaces/ai-usage-feature';
import { type AiUsageEntry, recordAiUsage } from './record-ai-usage';
import type { TokenUsage } from './token-usage';

const logger = loggerFactory('growi:features:ai-usage:services:usage-meter');

export type UsageMeterOutcome = 'completed' | 'failed';

export type UsageMeter = {
  /** Called once per finished LLM call. */
  add(usage: TokenUsage): void;
  /** Writes one record for the collected calls. Safe to call more than once. */
  close(params: { readonly outcome: UsageMeterOutcome }): void;
};

// Fire-and-forget: the response must never wait on, or fail because of, the usage write.
const saveWithoutWaiting = (entry: AiUsageEntry): void => {
  try {
    recordAiUsage(entry).catch((err: unknown) => {
      logger.error({ err }, 'Failed to record AI usage');
    });
  } catch (err) {
    logger.error({ err }, 'Failed to record AI usage');
  }
};

export const createUsageMeter = (params: {
  readonly userId: string;
  readonly feature: AiUsageFeature;
  readonly modelKey: ModelKey;
}): UsageMeter => {
  const { userId, feature, modelKey } = params;
  const collected: TokenUsage[] = [];
  let closed = false;

  return {
    add(usage) {
      if (closed) {
        // A call finishing after close (e.g. an abandoned stream) is still billed.
        saveWithoutWaiting({ userId, feature, modelKey, calls: [usage] });
        return;
      }
      collected.push(usage);
    },
    close({ outcome }) {
      if (closed) {
        return;
      }
      closed = true;

      if (collected.length === 0) {
        if (outcome === 'failed') {
          logger.warn(
            { userId, feature, modelKey },
            'AI response failed without reporting any token usage',
          );
        }
        return;
      }
      saveWithoutWaiting({ userId, feature, modelKey, calls: [...collected] });
    },
  };
};
