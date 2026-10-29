// The sweep of unpaired relations (task 8.2, Requirement 9.7's tail).
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
// Run once a day by `UnpairedRelationSweepCronService` on every instance.
// The links are removed first and the relation row
// is then deleted under the very condition that selected it, so two instances
// sweeping at once converge on the same end state and neither can leave an
// orphan behind.

import loggerFactory from '~/utils/logger';

import { UNPAIRED_RETENTION_MS } from '../../unpaired-retention';
import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatRelation } from '../models/chat-relation';

const logger = loggerFactory(
  'growi:features:chat-integration:sweep-unpaired-relations',
);

export { UNPAIRED_RETENTION_MS };

/**
 * Safety ceiling on the work of one run: the loop drains the whole backlog
 * (the run is daily, so a smaller cap would break the retention deadline), but
 * must not become unbounded against the database. The next daily run continues.
 */
export const MAX_RELATIONS_PER_SWEEP = 10_000;

export interface UnpairedSweepOptions {
  readonly maxRelations?: number;
}

export interface UnpairedSweepSummary {
  readonly relations: number;
  readonly accountLinks: number;
}

export const sweepUnpairedRelations = async (
  now: Date,
  { maxRelations = MAX_RELATIONS_PER_SWEEP }: UnpairedSweepOptions = {},
): Promise<UnpairedSweepSummary> => {
  const expiredBefore = new Date(now.getTime() - UNPAIRED_RETENTION_MS);
  let relations = 0;
  let accountLinks = 0;

  for (let i = 0; i < maxRelations; i++) {
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
    // run. The other order would strand the links permanently.
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
