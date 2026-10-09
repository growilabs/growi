// The "manage my existing links" half of ChatAccountLink (design.md
// "ChatAccountLink" -- 解除（要件7.5）と、個人設定の一覧（要件7.7）). Kept as
// a sibling of `account-link-service.ts`, not merged into it: that file's
// two functions share the "resolve a live one-time order by token" step
// (an anonymous-looking, short-lived `chat_account_link_orders` row); this
// module's two functions share a different step -- "query
// `chat_account_links` scoped to the CURRENTLY LOGGED-IN user" -- and share
// no helper with the approval flow. One file would mix two responsibilities
// (`.claude/rules/coding-style.md` "Responsibility-Based Submodule
// Decomposition").

import type { IUserHasId } from '@growi/core/dist/interfaces';
import mongoose from 'mongoose';

import { ChatRelation } from '../models/chat-relation';
import type { ChatAccountLinkDocument } from './models/chat-account-link';
import { ChatAccountLink } from './models/chat-account-link';

export interface AccountLinkListItem {
  /** `chat_account_links._id` -- the id `unlinkAccountLink` deletes by. */
  readonly id: string;
  readonly platform: ChatAccountLinkDocument['platform'];
  readonly accountId: string;
  /** From `chat_relations.workspaceName` -- see the module comment on why a join is needed. */
  readonly workspaceName: string;
  /** From `chat_relations.label`; `null` when the administrator never set one. */
  readonly relationLabel: string | null;
  readonly linkedAt: Date;
}

/**
 * Every chat account linked to `userId`, newest first, joined against
 * `chat_relations` for display info the same way
 * `account-link-service.ts`'s `getAccountLinkOrderForApproval` does --
 * except batched over every relation ID in the result set at once (not one
 * query per link), since Requirement 7.1 explicitly allows a single GROWI
 * user to hold links to more than one relation.
 */
export const listAccountLinksForUser = async (
  userId: IUserHasId['_id'],
): Promise<AccountLinkListItem[]> => {
  const links = await ChatAccountLink.find({ userId })
    .sort({ linkedAt: -1 })
    .lean();
  if (links.length === 0) {
    return [];
  }

  const relationIds = Array.from(new Set(links.map((link) => link.relationId)));
  const relations = await ChatRelation.find({
    relationId: { $in: relationIds },
  }).lean();
  const relationById = new Map(
    relations.map((relation) => [relation.relationId, relation]),
  );

  return links.map((link) => {
    const relation = relationById.get(link.relationId);
    return {
      id: link._id.toString(),
      platform: link.platform,
      accountId: link.accountId,
      // A missing relation is unreachable in practice -- a link can only be
      // created for a relation that exists, same assumption
      // `account-link-service.ts` makes -- but this is a display-only list,
      // so fall back rather than throw if it ever happened.
      workspaceName: relation?.workspaceName ?? 'Unknown workspace',
      relationLabel: relation?.label ?? null,
      linkedAt: link.linkedAt,
    };
  });
};

export type UnlinkAccountLinkResult = 'unlinked' | 'not-found';

/**
 * Deletes exactly one `chat_account_links` row -- scoped to `userId` in the
 * SAME query as the id match, so a caller can never delete another user's
 * link merely by guessing or observing its id (Requirement 7.5's "個別に解
 * 除できる" means "their own", not "any").
 *
 * This is a literal delete, not a soft-delete/revoke flag: design.md's
 * "解除（要件7.5）: 行を削除する" is explicit that this differs from
 * `chat_account_link_orders.isRevoked`, a different collection with a
 * different lifecycle (a one-time link that expires, not a standing link a
 * user manages).
 *
 * Deleting this row is the ENTIRE mechanism by which a subsequent write is
 * refused: `resolveActor` (task 3.3, unmodified by this task) already
 * returns `writeDenied: 'not-linked'` whenever its `ChatAccountLink.findOne`
 * comes back empty.
 */
export const unlinkAccountLink = async (
  userId: IUserHasId['_id'],
  linkId: string,
): Promise<UnlinkAccountLinkResult> => {
  // A malformed id would otherwise throw a Mongoose CastError rather than
  // resolving to "not found" -- treat it the same as a real, non-matching
  // id instead of leaking the distinction to the caller.
  if (!mongoose.isValidObjectId(linkId)) {
    return 'not-found';
  }

  const deleted = await ChatAccountLink.findOneAndDelete({
    _id: linkId,
    userId,
  });
  return deleted == null ? 'not-found' : 'unlinked';
};
