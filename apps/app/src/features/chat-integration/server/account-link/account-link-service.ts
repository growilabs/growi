// The approval half of the one-time account-link flow (design.md
// "ChatAccountLink" -- the "承認画面" and "承認" rows of the 発行/承認画面/
// 承認/失効 table). The "発行" half already exists (`create-link-order.ts`'s
// `findOrCreatePendingAccountLinkOrder`, reused unmodified by
// `peer-router.ts`'s `account-link-start` handler) -- this module does not
// duplicate any of that logic.
//
// Two responsibilities, kept in one file because they share the same
// "resolve a live order" step and the same three collections:
//   - `getAccountLinkOrderForApproval`: what the approval screen shows
//     (Requirement 7.3 -- "どのチャットアカウントを、どの GROWI ユーザーに
//     結び付けるのかを画面に出す")
//   - `approveAccountLink`: the actual link + revoke, atomically
//     (Requirement 7.4 -- "同じトランザクションで token を失効させる")

import type { IUserHasId } from '@growi/core/dist/interfaces';
import mongoose from 'mongoose';

import { ChatRelation } from '../models/chat-relation';
import { ChatAccountLink } from './models/chat-account-link';
import {
  ChatAccountLinkOrder,
  type ChatAccountLinkOrderDocument,
} from './models/chat-account-link-order';

export interface AccountLinkOrderDisplay {
  readonly platform: ChatAccountLinkOrderDocument['platform'];
  readonly accountId: string;
  /** From `chat_relations.workspaceName` (design.md: "chat_relations から引いて添える"). */
  readonly workspaceName: string;
  /** From `chat_relations.label`; `null` when the administrator never set one. */
  readonly relationLabel: string | null;
  /** The GROWI user who is ABOUT TO approve -- read from the caller's own session, never guessed. */
  readonly growiUsername: string;
  readonly expiresAt: Date;
}

export type GetAccountLinkOrderResult =
  | { readonly status: 'found'; readonly display: AccountLinkOrderDisplay }
  | { readonly status: 'not-found' };

export type ApproveAccountLinkResult =
  | { readonly status: 'linked' }
  /** Token does not exist, was already used, or is past `expiredAt`. Collapsed into one outcome -- see the module comment on `approveAccountLink`. */
  | { readonly status: 'invalid-or-expired' }
  /** The composite unique index on `chat_account_links` rejected the insert (Requirement 7.4). */
  | { readonly status: 'taken-by-another-user' };

/**
 * A "live" order: exists, not yet revoked, not past its expiry. Both
 * functions in this module start from this same definition, so the screen
 * and the approval never disagree about what counts as a usable link.
 */
const findLiveOrder = (
  token: string,
): Promise<ChatAccountLinkOrderDocument | null> =>
  ChatAccountLinkOrder.findOne({
    token,
    isRevoked: false,
    expiredAt: { $gt: new Date() },
  }).exec();

/**
 * Builds the display data for the approval screen. Never leaks WHY a token
 * doesn't resolve (not-found vs revoked vs expired all collapse to
 * `'not-found'`) -- the screen has no legitimate reason to distinguish them
 * for an anonymous-looking one-time link (apps/app/.claude/rules/
 * page-write-action-403-404.md's "uniform 404" reasoning applies the same
 * way here: it would only tell a prober which reason applied).
 */
export const getAccountLinkOrderForApproval = async (
  token: string,
  approvingUser: IUserHasId,
): Promise<GetAccountLinkOrderResult> => {
  const order = await findLiveOrder(token);
  if (order == null) {
    return { status: 'not-found' };
  }

  const relation = await ChatRelation.findOne({
    relationId: order.relationId,
  }).lean();
  if (relation == null) {
    // Unreachable in practice -- an order can only be created for a
    // relation that exists (see `findOrCreatePendingAccountLinkOrder`'s
    // caller, `account-link-start`). Answered safely rather than crashing.
    return { status: 'not-found' };
  }

  return {
    status: 'found',
    display: {
      platform: order.platform,
      accountId: order.accountId,
      workspaceName: relation.workspaceName,
      relationLabel: relation.label,
      growiUsername: approvingUser.username,
      expiresAt: order.expiredAt,
    },
  };
};

const DUPLICATE_KEY_ERROR_CODE = 11000;

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err != null &&
  'code' in err &&
  (err as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE;

/**
 * Approves a one-time link: creates `chat_account_links` and revokes the
 * order's token in the same transaction (Requirement 7.4). Also claims the
 * token atomically ON THE WAY IN (`findOneAndUpdate` with `isRevoked: false`
 * in its filter) so two concurrent approvals of the same token cannot both
 * see it as live -- the second one loses the claim and is refused, rather
 * than both racing to also create a `chat_account_links` row.
 *
 * devcontainer's MongoDB is a replica set, so `session.startTransaction()`
 * is available in every environment this runs in (see
 * .claude/rules/devcontainer.md).
 */
export const approveAccountLink = async (
  token: string,
  approvingUser: IUserHasId,
): Promise<ApproveAccountLinkResult> => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const claimedOrder = await ChatAccountLinkOrder.findOneAndUpdate(
      { token, isRevoked: false, expiredAt: { $gt: new Date() } },
      { isRevoked: true },
      { session },
    );

    if (claimedOrder == null) {
      await session.abortTransaction();
      return { status: 'invalid-or-expired' };
    }

    try {
      await ChatAccountLink.create(
        [
          {
            relationId: claimedOrder.relationId,
            userId: approvingUser._id,
            platform: claimedOrder.platform,
            accountId: claimedOrder.accountId,
          },
        ],
        { session },
      );
    } catch (err) {
      if (!isDuplicateKeyError(err)) {
        throw err;
      }

      // MongoDB aborts the WHOLE transaction the instant a write inside it
      // errors (including the `isRevoked: true` update above), so the token
      // is live again at this point -- the transaction never committed. This
      // is the one narrow, deliberate deviation from "revoke in the same
      // transaction as the link write": we cannot commit a transaction that
      // MongoDB has already forced to abort, so the revocation for THIS
      // race-losing branch is a separate, standalone write, issued only
      // after confirming the transaction is done aborting.
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      await ChatAccountLinkOrder.updateOne(
        { _id: claimedOrder._id },
        { isRevoked: true },
      );
      return { status: 'taken-by-another-user' };
    }

    await session.commitTransaction();
    return { status: 'linked' };
  } finally {
    await session.endSession();
  }
};
