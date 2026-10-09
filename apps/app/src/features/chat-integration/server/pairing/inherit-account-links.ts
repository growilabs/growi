// Carries every user's chat-account link over to a newly minted
// `relationId` when the same chat workspace is paired again after being
// unpaired (design.md "紐付けの一意性に workspace の軸が要る", Requirement 9.5).
//
// **Why this exists at all.** `chat_account_links`'s unique key is
// `(relationId, platform, accountId)`, and the proxy mints a brand-new
// `relationId` on every pairing -- it never reissues the old one (design.md
// "解除済みの行も一意索引の対象である"). So without this step, unpairing and
// pairing the same workspace again would leave every link pointing at a
// relation that no longer receives anything: design.md's own words, "繋ぎ直した
// だけで全利用者の紐付けが消える". The matching axis therefore has to be
// `(platform, workspaceId)` -- the pair that survives unpairing -- and never
// `relationId`.
//
// **Why it is not one transaction.** The moves are per-row, each one
// idempotent and safe to re-run, rather than a single MongoDB transaction
// over the whole batch. A relation can hold one link per GROWI user, so the
// batch is unbounded in principle (thousands of rows on a large instance),
// which is exactly the shape a single transaction handles worst -- it would
// have to hold every one of those writes in one oplog entry and finish inside
// the server's transaction lifetime, and a batch that grew past either limit
// would start failing entirely instead of partially. Re-running this function
// after an interruption converges on the same result: a row already moved is
// no longer in the old relation's set, and the "which of two colliding rows
// survives" rule below is decided by `linkedAt`, not by execution order. A
// partial run therefore leaves no row lost and no row duplicated -- just some
// still to move, which the next run moves.

import type { PlatformName } from '@growi/chat';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatRelation } from '../models/chat-relation';

/** The freshly paired relation the links are being moved TO. */
export interface InheritanceTarget {
  readonly relationId: string;
  readonly platform: PlatformName;
  readonly workspaceId: string;
}

export interface AccountLinkInheritance {
  /**
   * `relationId` of the unpaired relation the links came from, or `null` when
   * no unpaired relation matched this platform/workspace (the ordinary
   * first-ever pairing).
   */
  readonly inheritedFrom: string | null;
  /** Links repointed at the new `relationId`. */
  readonly movedCount: number;
  /** Colliding links deleted because the other side of the collision was newer. */
  readonly discardedCount: number;
}

/** Mongo's own duplicate-key code -- same check `key-store.ts` makes. */
const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 11000;

const NOTHING_INHERITED: AccountLinkInheritance = {
  inheritedFrom: null,
  movedCount: 0,
  discardedCount: 0,
};

/**
 * The unpaired relation this workspace's links should be inherited from: the
 * most recently unpaired one, per design.md's "引き継ぎ元が複数あるときは、いちばん
 * 新しい解除済みの行から引き継ぐ". Only one is chosen -- merging every unpaired
 * generation would resurrect links a user unlinked two pairings ago.
 */
const findSourceRelationId = async (
  target: InheritanceTarget,
): Promise<string | null> => {
  const source = await ChatRelation.findOne({
    state: 'unpaired',
    platform: target.platform,
    workspaceId: target.workspaceId,
    relationId: { $ne: target.relationId },
  })
    .sort({ unpairedAt: -1 })
    .lean();
  return source?.relationId ?? null;
};

/**
 * Moves the account links of the most recently unpaired relation for this
 * platform/workspace onto `target.relationId`.
 *
 * A collision -- a link for the same `(platform, accountId)` already existing
 * under the NEW `relationId`, because that user re-linked by hand before this
 * ran -- keeps whichever of the two was linked later and deletes the other
 * (design.md "ぶつかったら新しいほうを残し、古い行を消す"). Keeping both is not an
 * option: the unique index forbids it, and the two rows may name different
 * GROWI users, so there is no merge that is right in every case. "Whichever
 * the user established later" is the one that reflects their latest intent.
 *
 * The source relation's own `chat_relations` row is deliberately left in
 * place. Removing it belongs to the 90-day sweep (design.md "解除済みの
 * `chat_relations` の行そのものも 90 日で消す"), which is also what stops a row
 * from being inherited from twice in a way that matters -- once emptied, a
 * second run of this function finds no links to move.
 */
export const inheritAccountLinks = async (
  target: InheritanceTarget,
): Promise<AccountLinkInheritance> => {
  const sourceRelationId = await findSourceRelationId(target);
  if (sourceRelationId == null) {
    return NOTHING_INHERITED;
  }

  const links = await ChatAccountLink.find({
    relationId: sourceRelationId,
  }).lean();

  let movedCount = 0;
  let discardedCount = 0;

  for (const link of links) {
    // biome-ignore lint/performance/noAwaitInLoops: each row is moved on its own so an interrupted run stays re-runnable (see this file's header) — parallelising would make two colliding rows race on the unique index
    const existing = await ChatAccountLink.findOne({
      relationId: target.relationId,
      platform: link.platform,
      accountId: link.accountId,
    }).lean();

    if (existing != null) {
      if (existing.linkedAt.getTime() >= link.linkedAt.getTime()) {
        // The already-relinked row is the newer one: drop the inherited row.
        await ChatAccountLink.deleteOne({ _id: link._id });
        discardedCount += 1;
        continue;
      }
      // The inherited row is the newer one: the already-relinked row goes,
      // then the inherited row takes its place.
      await ChatAccountLink.deleteOne({ _id: existing._id });
      discardedCount += 1;
    }

    try {
      await ChatAccountLink.updateOne(
        { _id: link._id },
        { $set: { relationId: target.relationId } },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      // A row for this `(relationId, platform, accountId)` appeared between
      // the read above and this write (a user re-linking by hand at the same
      // moment). That row is by definition the later of the two, so it is the
      // one that survives -- the same rule the branch above applies.
      await ChatAccountLink.deleteOne({ _id: link._id });
      discardedCount += 1;
      continue;
    }
    movedCount += 1;
  }

  return { inheritedFrom: sourceRelationId, movedCount, discardedCount };
};
