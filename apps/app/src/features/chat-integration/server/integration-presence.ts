import loggerFactory from '~/utils/logger';

import { ChatRelation } from './models/chat-relation';

const logger = loggerFactory(
  'growi:features:chat-integration:integration-presence',
);

/** How long a presence answer, either way, is trusted before asking again. */
export const PRESENCE_ANSWER_TTL_MS = 10 * 60 * 1000;

export interface IntegrationPresence {
  /** True when at least one `chat_relations` row exists, in any state. */
  hasAnyIntegration(now: Date): Promise<boolean>;
  /** Record that this process just wrote an outbox row. Never queries. */
  markPresent(now: Date): void;
}

export interface IntegrationPresenceDeps {
  /** Test seam; production uses `ChatRelation.exists({})`. */
  readonly anyRelationExists?: () => Promise<boolean>;
}

interface RememberedAnswer {
  readonly present: boolean;
  readonly decidedAt: number;
}

const defaultAnyRelationExists = async (): Promise<boolean> =>
  (await ChatRelation.exists({})) != null;

export const createIntegrationPresence = (
  deps: IntegrationPresenceDeps = {},
): IntegrationPresence => {
  const anyRelationExists = deps.anyRelationExists ?? defaultAnyRelationExists;

  let remembered: RememberedAnswer | null = null;
  let inFlight: Promise<boolean> | null = null;

  const ask = async (now: Date): Promise<boolean> => {
    try {
      const present = await anyRelationExists();
      // A markPresent made while this query ran is newer and must survive.
      if (remembered == null || remembered.decidedAt <= now.getTime()) {
        remembered = { present, decidedAt: now.getTime() };
      }
      return present;
    } catch (err) {
      // Failing open keeps a broken check from silencing notifications.
      logger.warn(
        'Failed to check whether any chat integration exists; assuming one does',
        err,
      );
      return true;
    }
  };

  return {
    hasAnyIntegration(now: Date): Promise<boolean> {
      if (
        remembered != null &&
        now.getTime() - remembered.decidedAt < PRESENCE_ANSWER_TTL_MS
      ) {
        return Promise.resolve(remembered.present);
      }
      // Cleared after the assignment, so a synchronous failure inside ask()
      // cannot leave a settled promise behind.
      inFlight ??= ask(now).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    markPresent(now: Date): void {
      remembered = { present: true, decidedAt: now.getTime() };
    },
  };
};

export const integrationPresence: IntegrationPresence =
  createIntegrationPresence();
