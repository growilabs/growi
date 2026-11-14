// The two thread roots of a message the bot was handed (design.md's
// EventMapping section): where it was actually posted, and where an answer to
// it goes. Each adapter encodes a thread root in its own thread id, so how to
// read one is declared per service below; the rule that turns it into the two
// roots is the same for all four.
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';

export interface ThreadRootReading {
  /** The root `adapter` encoded into `threadId`; `''` when it encoded none. */
  readonly rootIn: (adapter: Adapter, threadId: string) => string;
  /** Whether a DM on this service has replies under a message to answer in. */
  readonly directMessageHasThreads: boolean;
}

/** `decodeThreadId` is typed per adapter, so its fields are read structurally. */
const decodedField = (
  adapter: Adapter,
  threadId: string,
  field: string,
): string => {
  const decoded: unknown = adapter.decodeThreadId(threadId);
  if (decoded == null || typeof decoded !== 'object') return '';
  const value: unknown = (decoded as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
};

const TEAMS_ROOT_IN_CONVERSATION = /;messageid=(\d+)/;

/** One entry per `PlatformName`; a missing service will not compile. */
export const THREAD_ROOT_READINGS: Readonly<
  Record<PlatformName, ThreadRootReading>
> = {
  // `thread_ts || ts`; empty for a DM message outside a thread while the AI
  // app view is off.
  slack: {
    rootIn: (adapter, threadId) => decodedField(adapter, threadId, 'threadTs'),
    directMessageHasThreads: true,
  },
  // The thread channel; one the adapter starts from a message shares that
  // message's id. Discord refuses to start a thread in a DM (API error 50003),
  // so a DM never has one.
  discord: {
    rootIn: (adapter, threadId) => decodedField(adapter, threadId, 'threadId'),
    directMessageHasThreads: false,
  },
  // `;messageid=` on a channel conversation names its root post, which is
  // the post itself outside a thread. A 1:1 chat has no reply hierarchy.
  teams: {
    rootIn: (adapter, threadId) =>
      TEAMS_ROOT_IN_CONVERSATION.exec(
        decodedField(adapter, threadId, 'conversationId'),
      )?.[1] ?? '',
    directMessageHasThreads: false,
  },
  // `root_id || id`.
  mattermost: {
    rootIn: (adapter, threadId) =>
      decodedField(adapter, threadId, 'rootPostId'),
    directMessageHasThreads: true,
  },
};

export interface ThreadRoots {
  readonly threadRootId: string | null;
  readonly replyThreadRootId: string | null;
}

/**
 * A root equal to the message's own id is the message itself, not a thread
 * it was posted in. A DM message outside a thread is answered under itself
 * wherever the service has replies in a DM (design.md's EventMapping section).
 */
export const threadRootsOf = (
  reading: ThreadRootReading,
  message: {
    readonly adapter: Adapter;
    readonly threadId: string;
    readonly messageId: string;
    readonly isDirectMessage: boolean;
  },
): ThreadRoots => {
  const root = reading.rootIn(message.adapter, message.threadId);
  if (root !== '' && root !== message.messageId) {
    return { threadRootId: root, replyThreadRootId: root };
  }
  return {
    threadRootId: null,
    replyThreadRootId:
      message.isDirectMessage && reading.directMessageHasThreads
        ? message.messageId
        : null,
  };
};
