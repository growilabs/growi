// The account-linking contract (Requirement 7): starting a link from the
// chat side, and the three outcomes GROWI can answer with. This is its own
// contract, deliberately separate from `command.ts`'s CommandRequest /
// CommandResponse -- linking is not a command (it has its own op and its
// own response vocabulary), so it must not be folded into that union.

import type { OP_NAMES, RequestEnvelope } from '../endpoints/op-names.js';
import type { ChatAccountRef } from './common.js';

/**
 * Account linking starts from the CHAT SIDE. When a user asks to link accounts in chat,
 * GROWI returns a one-time, short-lived link in an ephemeral chat message, and linking is
 * completed when the user opens it WHILE LOGGED INTO GROWI and approves it (Req 7.3).
 *
 * Without this flow in the contract, we'd regress to Gen 1's flaw: the user manually pastes
 * their chat ID into their GROWI personal settings. There's no identity verification, and
 * whoever pastes another person's ID first can block that person's real link.
 */
export interface AccountLinkStartRequest extends RequestEnvelope {
  readonly op: typeof OP_NAMES.accountLinkStart;
  readonly actor: ChatAccountRef;
}

/**
 * Account linking is scoped to a single GROWI instance. Linking on one GROWI does NOT
 * extend to another GROWI instance that shares the same chat workspace -- each GROWI
 * keeps its own independent user database (Requirement 7.2). In a channel connected to
 * 3 GROWI instances, the user goes through this flow 3 separate times, once per instance.
 */
export type AccountLinkStartResponse =
  | {
      readonly status: 'link-issued';
      readonly linkUrl: string;
      readonly expiresAt: string;
    }
  | { readonly status: 'already-linked'; readonly growiUserName: string }
  | { readonly status: 'taken-by-another-user' }; // Req 7.4 (unique WITHIN one GROWI)
