// Internal helpers shared by more than one parse* function across this
// directory (`ChatAccountRef` is carried by both `CommandRequest.actor` and
// `AccountLinkStartRequest.actor`; `ChannelRef` by `CommandRequest.channel`;
// `PublicKeyRegistration` by `KeyRegistrationRequest.key`,
// `PairingSubmission.publicKey`, and `PairingResult`'s `paired` variant).
// NOT part of any public barrel -- task 7.1 owns the package's two entry
// points. Sibling files under `parse/` import this one directly, the same
// way they import `./shape.js`.

import type {
  ChannelRef,
  ChatAccountRef,
  PlatformName,
} from '../contract/common.js';
import type { PublicKeyRegistration } from '../contract/pairing.js';
// Deliberately importing these two leaf files directly, NOT
// `../signature/index.js`. Both files have zero imports of their own (no
// `node:crypto`), but `signature/index.ts` also re-exports `sign.ts`/
// `verify.ts`, which DO import `node:crypto`. This file is used by
// client-safe `src/index.ts` (via several re-exported parse* functions), so
// importing the signature barrel here would pull `node:crypto` into the
// client bundle -- exactly what `public-surface.spec.ts` (task 1.2) exists
// to catch.
import { isValidKeyIdShape } from '../signature/key-identity.js';
import { isValidPublicKeyMaterial } from '../signature/key-material.js';
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

/**
 * `str`'s max here only needs to be >= `isValidKeyIdShape`'s own upper
 * bound (64, `KEY_ID_SHAPE_PATTERN` in `signature/key-identity.ts`) -- that
 * function is the real authority on keyId's shape, this is just a
 * defensive outer bound before handing the value to it.
 */
const KEY_ID_MAX = 128;
/** ISO-8601 timestamp (`Date#toISOString()`, see tasks.md's 4.3 Implementation Note). */
const VALID_FROM_MAX = 64;

/**
 * `PublicKeyRegistration` (`keyId`/`publicKeyJwk`/`validFrom`) is carried
 * by THREE different contract shapes: `KeyRegistrationRequest.key`
 * (parse-keys.ts), `PairingSubmission.publicKey` (parse-pairing.ts), and
 * `PairingResult`'s `paired` variant (parse-responses.ts, task 6.5). Per
 * tasks.md's 6.3->6.5 Implementation Note, this check is centralized here
 * instead of being hand-copied a third time -- all 3 call sites delegate
 * to this one function. Public-key material judgement itself is NOT
 * re-derived here either: `isValidKeyIdShape`/`isValidPublicKeyMaterial`
 * (task 2.4) already own that logic.
 */
export const parsePublicKeyRegistration = (
  v: unknown,
): PublicKeyRegistration | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const keyId = str(v.keyId, KEY_ID_MAX);
  const validFrom = str(v.validFrom, VALID_FROM_MAX);
  const publicKeyJwk = v.publicKeyJwk;

  if (
    keyId === undefined ||
    validFrom === undefined ||
    !isRecord(publicKeyJwk) ||
    !isValidKeyIdShape(keyId) ||
    !isValidPublicKeyMaterial(publicKeyJwk).ok
  ) {
    return undefined;
  }

  return { keyId, publicKeyJwk, validFrom };
};
