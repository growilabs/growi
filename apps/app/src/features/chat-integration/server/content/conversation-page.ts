// Turning a `keep` command's message list into page body markdown
// (design.md's `ConversationPage` -- Requirements 5.2, 5.3).
//
// This is a DIFFERENT question from `resolveActor`'s (`../command/resolve-actor.ts`):
// that one resolves ONE chat account -- the person who issued the `keep` command --
// to the GROWI user who will be recorded as the PAGE's creator, and denies writes a
// suspended/read-only person may not make. This module resolves MANY chat accounts --
// every distinct speaker across the imported range -- to a display name for each
// MESSAGE, and a message's author attribution is a display fact, not a permission
// decision: `keep`'s own write permission was already settled by `resolveActor` for
// the person who ran the command, not for anyone quoted in the transcript. So this
// module does not check `isActiveUserStatus` / `isReadOnlyUser` at all, and does not
// take an "actor" parameter -- see the note on `buildConversationPageBody` below.
//
// Design constraint (design.md, "投稿者の解決は発言ごと、まとめて 1 回"): resolving
// each message's author with its own `chat_account_links` query would be one query
// per message -- 100 queries for a 100-message import. Every distinct `accountId`
// that appears is collected first, then `chat_account_links` is queried ONCE with an
// `$or` over `{ platform, accountId }` pairs (scoped by `relationId`, the compound
// key's third field) to fetch every linked account in a single round trip.

import type { ChatAccountRef, KeepMessage, PlatformName } from '@growi/chat';
import type { IUser } from '@growi/core';
import mongoose from 'mongoose';

import { ChatAccountLink } from '../account-link/models/chat-account-link';

/** Groups `find`'s lean projection down to the two fields this module reads. */
interface LinkedAccountRow {
  readonly platform: PlatformName;
  readonly accountId: string;
  readonly userId: mongoose.Types.ObjectId;
}

/** The one field this module reads off a linked GROWI user. */
interface LinkedUserRow {
  readonly _id: mongoose.Types.ObjectId;
  readonly username: string;
}

const accountKey = (platform: PlatformName, accountId: string): string =>
  `${platform}::${accountId}`;

/**
 * Every distinct `(platform, accountId)` pair that appears among `messages`'
 * authors, in first-seen order. Order does not matter for the query built
 * from it, but keeping it deterministic makes the batching logic easy to
 * reason about and test.
 */
const distinctAuthors = (
  messages: readonly KeepMessage[],
): ReadonlyArray<ChatAccountRef> => {
  const seen = new Map<string, ChatAccountRef>();
  for (const message of messages) {
    const key = accountKey(message.author.platform, message.author.accountId);
    if (!seen.has(key)) {
      seen.set(key, message.author);
    }
  }
  return [...seen.values()];
};

/**
 * Fetches every GROWI username linked to any of `authors`, keyed by
 * `(platform, accountId)`. Exactly one query against `chat_account_links`
 * and one against `User`, regardless of how many distinct authors or
 * messages there are -- neither query is repeated per author or per
 * message.
 *
 * Deliberately does NOT check `isActiveUserStatus` / `isReadOnlyUser`
 * (contrast `resolveActor`): a past message's author name is a display
 * fact about who said something, not a decision about who may act now.  A
 * message posted by someone whose GROWI account is later suspended still
 * shows that person's username -- suspending a user does not rewrite
 * history.
 */
const resolveAuthorUsernames = async (
  relationId: string,
  authors: readonly ChatAccountRef[],
): Promise<ReadonlyMap<string, string>> => {
  if (authors.length === 0) {
    return new Map();
  }

  const links = await ChatAccountLink.find({
    relationId,
    $or: authors.map((author) => ({
      platform: author.platform,
      accountId: author.accountId,
    })),
  })
    .select('platform accountId userId')
    .lean<LinkedAccountRow[]>();

  if (links.length === 0) {
    return new Map();
  }

  const User = mongoose.model<IUser>('User');
  const users = await User.find({
    _id: { $in: links.map((link) => link.userId) },
  })
    .select('_id username')
    .lean<LinkedUserRow[]>();

  const usernameById = new Map(
    users.map((user) => [user._id.toString(), user.username]),
  );

  const usernameByAccount = new Map<string, string>();
  for (const link of links) {
    const username = usernameById.get(link.userId.toString());
    if (username != null) {
      usernameByAccount.set(
        accountKey(link.platform, link.accountId),
        username,
      );
    }
  }
  return usernameByAccount;
};

/** How one message renders once its author's display name is decided. */
const renderMessage = (message: KeepMessage, displayName: string): string =>
  `**${displayName}** (${message.postedAt})\n\n${message.markdown}`;

/**
 * Builds the markdown body for a page created from a `keep` command's
 * imported range (Requirement 5.2), attributing each message to its
 * speaker (Requirement 5.3): the GROWI username when the speaker's chat
 * account is linked, otherwise their chat display name verbatim -- never a
 * placeholder like "unknown". `messages` is rendered in the order given;
 * the proxy is the one that collects history in posted order (design.md:
 * "GROWI は集めに行かない"), so this function does not re-sort.
 *
 * Takes no "actor" parameter on purpose: the person who ran `keep` is
 * resolved separately, by `resolveActor`, and becomes the created page's
 * author -- a decision this function does not make and a value it does
 * not need, because it only assembles body content. Mixing the two would
 * confuse "who is allowed to create this page" with "who is quoted in
 * it", which design.md calls out as two different people.
 */
export const buildConversationPageBody = async (
  relationId: string,
  messages: readonly KeepMessage[],
): Promise<string> => {
  if (messages.length === 0) {
    return '';
  }

  const usernameByAccount = await resolveAuthorUsernames(
    relationId,
    distinctAuthors(messages),
  );

  return messages
    .map((message) => {
      const username = usernameByAccount.get(
        accountKey(message.author.platform, message.author.accountId),
      );
      return renderMessage(message, username ?? message.author.displayName);
    })
    .join('\n\n---\n\n');
};
