import { toProtocolChannelRef } from '../capabilities/index.js';
import type { Invocation } from '../types/index.js';

/**
 * The key GROWI folds into its conversation id, built from chat-side ids
 * only: `<platform>:<channelId>:<reply thread root, else the request's own
 * message id>` (design.md, CommandVocabulary). `null` when neither root
 * exists, which is a slash command: it carries no message to root on.
 */
export const conversationKeyOf = (invocation: Invocation): string | null => {
  const root = invocation.replyThreadRootId ?? invocation.sourceMessageId;
  if (root == null) return null;
  const { platform, channelId } = toProtocolChannelRef(invocation.channel);
  return `${platform}:${channelId}:${root}`;
};
