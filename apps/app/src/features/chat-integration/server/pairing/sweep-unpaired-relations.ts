// The 90-day sweep of unpaired relations (task 8.2, Requirement 9.7's tail).
//
// Unlinking deliberately does NOT delete the `chat_relations` row: `platform`
// and `workspaceId` have to survive so that re-pairing the same workspace can
// inherit every user's account links onto the new `relationId` (see
// `inherit-account-links.ts`). That is what makes a sweep necessary -- the row
// is kept for the benefit of a re-pairing that may never come, so something
// has to retire it eventually, together with the account links it still owns.
//
// Why not a TTL index on `unpairedAt`: MongoDB's TTL monitor deletes the
// relation row alone, and the `chat_account_links` rows underneath it would be
// left orphaned with no relation to identify them by. The two have to go in
// one pass, which means application code.
//
// Runs on the same tick, and with the same "only one instance actually does
// the work" property, as `NotificationDispatcher.drain` (design.md "90 日の
// 掃除は `NotificationDispatcher` と同じく条件つき更新で 1 台だけが回す"): the
// links are removed first and the relation row is then deleted under the very
// condition that selected it, so two instances sweeping at once converge on
// the same end state and neither can leave an orphan behind.

import loggerFactory from '~/utils/logger';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatRelation } from '../models/chat-relation';

const logger = loggerFactory(
  'growi:features:chat-integration:sweep-unpaired-relations',
);

/**
 * How long an unpaired relation is kept so a re-pairing can still inherit
 * its account links. design.md: "解除済みの `chat_relations` の行そのものも
 * 90 日で消す（`chat_account_links` と揃える）".
 */
export const UNPAIRED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Bound on one sweep, so a large backlog spreads over several ticks. */
const MAX_RELATIONS_PER_SWEEP = 100;

export interface UnpairedSweepSummary {
  readonly relations: number;
  readonly accountLinks: number;
}

export const sweepUnpairedRelations = async (
  now: Date,
): Promise<UnpairedSweepSummary> => {
  const expiredBefore = new Date(now.getTime() - UNPAIRED_RETENTION_MS);
  let relations = 0;
  let accountLinks = 0;

  for (let i = 0; i < MAX_RELATIONS_PER_SWEEP; i++) {
    const expiredCondition = {
      state: 'unpaired',
      unpairedAt: { $lt: expiredBefore },
    } as const;

    const candidate = await ChatRelation.findOne(expiredCondition).lean();
    if (candidate == null) {
      break;
    }

    // Links first: if this process dies between the two deletes, the
    // relation row is still there to identify the remainder on the next
    // tick. The other order would strand the links permanently.
    const linkDeletion = await ChatAccountLink.deleteMany({
      relationId: candidate.relationId,
    });
    const relationDeletion = await ChatRelation.deleteOne({
      relationId: candidate.relationId,
      ...expiredCondition,
    });

    accountLinks += linkDeletion.deletedCount ?? 0;
    if ((relationDeletion.deletedCount ?? 0) > 0) {
      relations += 1;
      logger.info(
        { relationId: candidate.relationId },
        'Removed an unpaired chat relation past its retention',
      );
    }
  }

  return { relations, accountLinks };
};
