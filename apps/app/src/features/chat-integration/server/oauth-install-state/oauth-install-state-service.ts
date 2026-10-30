// Issuing and verifying the OAuth install `state` (task 9.0; see
// `models/chat-oauth-install-state.ts`'s header for what this protects and
// why it is a separate concept from account-link orders / pending
// pairings).
//
// **What this module does NOT do.** It does not build the chat service's
// OAuth authorize URL, and it is not called from
// `chat-integration-proxy`'s `routes/install-routes.ts` -- both would
// require either a new cross-repo contract in `@growi/chat` (naming the
// authorize-URL-building endpoint and how `chat-integration-proxy` hands a
// `state` back to GROWI for verification) or a change to
// `chat-integration-proxy` itself, neither of which is this task's boundary
// (`AdminChatIntegration`, `chat-integration-app` only). See this task's own
// status report for the precise gap. What IS implemented here is the
// self-contained half GROWI owns regardless of how that wiring is decided:
// generate an unpredictable token, hold it briefly, and verify+consume a
// candidate exactly once.
import { randomBytes } from 'node:crypto';
import type { PlatformName } from '@growi/chat';
import type { Types } from 'mongoose';

import {
  ChatOAuthInstallState,
  OAUTH_INSTALL_STATE_DEFAULT_MINUTES,
} from './models/chat-oauth-install-state';

// Re-exported so callers that only need the lifetime (e.g. to word an admin
// screen message) do not have to reach into the model module themselves --
// mirrors `create-link-order.ts`'s re-export of its own order's lifetime.
export { OAUTH_INSTALL_STATE_DEFAULT_MINUTES };

/** 256 bits, matching `create-link-order.ts`'s `generateToken` -- the same
 * cryptographic-randomness convention this feature already uses for every
 * other one-time token (account-link orders, pairing registration codes). */
const generateState = (): string => randomBytes(32).toString('hex');

export interface IssuedOAuthInstallState {
  readonly state: string;
  readonly expiresAt: Date;
}

/** Starts a "connect a new workspace" attempt: a fresh, unpredictable token
 * tied to the admin who requested it and the platform they are connecting. */
export const issueOAuthInstallState = async (
  createdBy: Types.ObjectId,
  platform: PlatformName,
): Promise<IssuedOAuthInstallState> => {
  const doc = await ChatOAuthInstallState.create({
    state: generateState(),
    platform,
    createdBy,
  });
  return { state: doc.state, expiresAt: doc.expiresAt };
};

export type VerifyOAuthInstallStateFailureReason =
  /** The caller sent no state at all -- refused without a DB round-trip. */
  | 'empty'
  /** No token was ever issued with this value. */
  | 'unknown'
  /** A matching token exists but its `expiresAt` has passed. */
  | 'expired'
  /** A matching token exists but was already claimed by an earlier verify call. */
  | 'already-consumed';

export type VerifyOAuthInstallStateResult =
  | {
      readonly ok: true;
      readonly platform: PlatformName;
      readonly createdBy: Types.ObjectId;
    }
  | {
      readonly ok: false;
      readonly reason: VerifyOAuthInstallStateFailureReason;
    };

/**
 * Verifies a candidate `state` and, if it is valid, consumes it -- a second
 * call with the same value always fails afterward (`already-consumed`),
 * matching the one-time-use pattern `chat_account_link_orders` /
 * `chat_pending_pairings` already follow elsewhere in this feature.
 *
 * The claim itself (`findOneAndUpdate` filtering on `consumedAt: null` AND
 * `expiresAt > now` in one atomic operation) is the only step the security
 * decision depends on -- two concurrent calls with the same valid token can
 * never both succeed. The follow-up `findOne` below runs only to produce a
 * precise failure reason for logging/testing and does not change or widen
 * that decision.
 */
export const verifyOAuthInstallState = async (
  candidateState: string,
  now: Date = new Date(),
): Promise<VerifyOAuthInstallStateResult> => {
  if (candidateState === '') {
    return { ok: false, reason: 'empty' };
  }

  const claimed = await ChatOAuthInstallState.findOneAndUpdate(
    { state: candidateState, consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { new: true },
  ).lean();

  if (claimed != null) {
    return {
      ok: true,
      platform: claimed.platform,
      createdBy: claimed.createdBy,
    };
  }

  const existing = await ChatOAuthInstallState.findOne({
    state: candidateState,
  }).lean();
  if (existing == null) {
    return { ok: false, reason: 'unknown' };
  }
  if (existing.consumedAt != null) {
    return { ok: false, reason: 'already-consumed' };
  }
  return { ok: false, reason: 'expired' };
};
