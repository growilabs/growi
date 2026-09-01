// Internal helpers shared by more than one of task 6.2's parse* functions
// (`ChatAccountRef` is carried by both `CommandRequest.actor` and
// `AccountLinkStartRequest.actor`; `ChannelRef` by `CommandRequest.channel`).
// NOT part of any public barrel -- task 7.1 owns the package's two entry
// points. Sibling files under `parse/` import this one directly, the same
// way they import `./shape.js`.

import type {
  ChannelRef,
  ChatAccountRef,
  PlatformName,
} from '../contract/common.js';
import { isRecord, oneOf, str } from './shape.js';

/**
 * `contract/common.ts` declares `PlatformName` as a plain string-literal
 * union, not a `COMMAND_NAMES`/`OP_NAMES`-style const object, so there is no
 * existing runtime array to reuse here. Keep this list in sync with that
 * union by hand -- there are only 4 platforms and adding one is rare enough
 * that a compile-time-enforced link (like `Object.values(COMMAND_NAMES)`)
 * isn't worth the indirection.
 */
export const PLATFORM_NAMES: ReadonlyArray<PlatformName> = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];

// Defensive upper bounds (Requirement 10.1 / task 6.1's rationale): a
// signature only proves the body wasn't altered in transit, never that its
// fields are a sane size. None of these numbers come from design.md -- it
// leaves them to be chosen here -- so they're picked generously relative to
// any real chat-platform id/name/display-name length, not derived from a
// business rule.
const ACCOUNT_ID_MAX = 200;
const DISPLAY_NAME_MAX = 200;
const CHANNEL_ID_MAX = 200;
const CHANNEL_NAME_MAX = 200;

export const parseChatAccountRef = (v: unknown): ChatAccountRef | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const platform = oneOf(v.platform, PLATFORM_NAMES);
  const accountId = str(v.accountId, ACCOUNT_ID_MAX);
  const displayName = str(v.displayName, DISPLAY_NAME_MAX);

  if (
    platform === undefined ||
    accountId === undefined ||
    displayName === undefined
  ) {
    return undefined;
  }

  return { platform, accountId, displayName };
};

export const parseChannelRef = (v: unknown): ChannelRef | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const platform = oneOf(v.platform, PLATFORM_NAMES);
  const channelId = str(v.channelId, CHANNEL_ID_MAX);
  const channelName = str(v.channelName, CHANNEL_NAME_MAX);
  const isPrivate = v.isPrivate;

  if (
    platform === undefined ||
    channelId === undefined ||
    channelName === undefined ||
    typeof isPrivate !== 'boolean'
  ) {
    return undefined;
  }

  return { platform, channelId, channelName, isPrivate };
};
