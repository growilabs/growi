// Building a one-time account-link URL, shared by every place that must
// answer "you need to link your GROWI account" (design.md's "要件 7.6 の案内
// account-link-required"). Extracted as its own module rather than
// duplicated inside CommandEndpoint, because task 6.1 (`account-link-start`,
// design.md's op table) creates a `chat_account_link_order` row for the exact
// same reason -- "a pending order for this chat account already exists, reuse
// it, do not multiply one-time links on retry" (design.md's dedup table,
// "account-link-start" row). Both callers must share ONE definition of "find
// or create the pending order", or they will drift into two different
// answers for the same account.
//
// design.md never pins the exact route this link points to -- the personal
// settings tab that accepts it (task 6.2) does not exist yet. The path below
// is a placeholder namespace reserved for that screen; whichever task builds
// it must keep this same path (or update this constant), not invent a
// second one.

import { randomBytes } from 'node:crypto';
import type { ChatAccountRef } from '@growi/chat';
import urljoin from 'url-join';

import { growiInfoService } from '~/server/service/growi-info';

import {
  ACCOUNT_LINK_ORDER_DEFAULT_MINUTES,
  ChatAccountLinkOrder,
  type ChatAccountLinkOrderDocument,
} from './models/chat-account-link-order';

// Re-exported so callers that only need the lifetime (e.g. to word a
// message) do not have to reach into the model module themselves.
export { ACCOUNT_LINK_ORDER_DEFAULT_MINUTES };

/** Path the one-time link resolves to, relative to the site root. Reserved for task 6.2's personal-settings screen. */
const ACCOUNT_LINK_ACCEPT_PATH = '/me/chat-integration/account-link';

const generateToken = (): string => randomBytes(32).toString('hex');

/**
 * Finds the still-valid pending order for this chat account on this
 * relation, or creates a new one. Never creates a second one while an
 * unexpired, unrevoked order already exists -- a fresh token on every retry
 * would leave the chat user with a growing pile of one-time links, all but
 * the last one dead on arrival.
 */
export const findOrCreatePendingAccountLinkOrder = async (
  relationId: string,
  actor: ChatAccountRef,
): Promise<ChatAccountLinkOrderDocument> => {
  const existing = await ChatAccountLinkOrder.findOne({
    relationId,
    platform: actor.platform,
    accountId: actor.accountId,
    isRevoked: false,
    expiredAt: { $gt: new Date() },
  });
  if (existing != null) {
    return existing;
  }

  return ChatAccountLinkOrder.create({
    token: generateToken(),
    relationId,
    platform: actor.platform,
    accountId: actor.accountId,
  });
};

/** The absolute URL a chat user follows to complete account linking (Requirement 7.3/7.6). */
export const buildAccountLinkUrl = (token: string): string =>
  urljoin(growiInfoService.getSiteUrl(), ACCOUNT_LINK_ACCEPT_PATH, token);
