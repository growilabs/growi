// The command request/response contract shared by both sides of the
// integration. `CommandRequest.kind` and `CommandResponse.kind` are both
// keyed off named constants (COMMAND_NAMES / RESPONSE_KINDS) rather than
// hand-typed string literals, so a name that was never declared cannot be
// written as either side's discriminant.

import type { COMMAND_NAMES, CommandName } from '../commands/command-names.js';
import type { OP_NAMES, RequestEnvelope } from '../endpoints/op-names.js';
import type { ChannelRef, ChatAccountRef } from './common.js';

/**
 * The common envelope every command request carries. `relationId` and `op`
 * come from `RequestEnvelope`.
 */
export interface CommandEnvelope extends RequestEnvelope {
  readonly op: typeof OP_NAMES.command;
  /**
   * Unchanged across retries. Used for duplicate-execution detection
   * (Requirement 10.4). Distinct per target: a fan-out to several GROWI
   * instances gives each target its own `requestId`.
   */
  readonly requestId: string;
  readonly actor: ChatAccountRef;
  /**
   * Which channel the command came from. GROWI re-judges channel
   * permission with this too.
   *
   * NOTE: the proxy self-reports this value, so it is NOT a defense
   * against a compromised proxy (except for commands disallowed
   * everywhere). See the umbrella spec's Security Considerations.
   */
  readonly channel: ChannelRef;
}

/**
 * `kind` is `CommandName` itself -- no string literal is written here
 * separately from `COMMAND_NAMES`. If `COMMAND_NAMES` is later missing a
 * name, or a caller writes a name that was never declared there, this
 * union does not typecheck.
 */
export type CommandRequest = CommandEnvelope &
  (
    | {
        readonly kind: typeof COMMAND_NAMES.search;
        readonly keyword: string;
        readonly limit: number;
      }
    | {
        readonly kind: typeof COMMAND_NAMES.createPage;
        readonly path: string;
        readonly body: string;
      }
    | {
        readonly kind: typeof COMMAND_NAMES.keep;
        readonly path: string;
        readonly messages: ReadonlyArray<KeepMessage>;
      }
    | {
        readonly kind: typeof COMMAND_NAMES.linkPreview;
        readonly pageUrl: string;
      }
    | { readonly kind: typeof COMMAND_NAMES.help }
  );

/**
 * Requirement 5.2 / 5.3: the speaker stays a chat-side identifier here;
 * GROWI resolves it to a GROWI user (if linked) when the page is created.
 */
export interface KeepMessage {
  readonly postedAt: string;
  readonly author: ChatAccountRef;
  readonly markdown: string;
}

/** Requirement 3.9: structured data, not a pre-rendered display string. */
export interface SearchResultItem {
  readonly rank: number;
  readonly path: string;
  readonly title: string;
  readonly url: string;
  readonly updatedAt: string;
  readonly commentCount: number;
}

/**
 * Response-kind vocabulary. Same treatment as `CommandRequest`'s
 * `COMMAND_NAMES` -- if only one side is a constant, the hand-written
 * string on the other side can silently typo without either side
 * noticing.
 */
export const RESPONSE_KINDS = {
  search: 'search',
  created: 'created',
  linkPreview: 'link-preview',
  help: 'help',
  accountLinkRequired: 'account-link-required',
  error: 'error',
} as const;

export type ResponseKind = (typeof RESPONSE_KINDS)[keyof typeof RESPONSE_KINDS];

export type CommandResponse =
  | {
      readonly kind: typeof RESPONSE_KINDS.search;
      readonly items: ReadonlyArray<SearchResultItem>;
      readonly appliedAs: 'linked-user' | 'anonymous';
    }
  /** create-page and keep both return this. */
  | {
      readonly kind: typeof RESPONSE_KINDS.created;
      readonly pageUrl: string;
      readonly importedMessageCount?: number;
    }
  | {
      readonly kind: typeof RESPONSE_KINDS.linkPreview;
      readonly path: string;
      readonly restricted: boolean;
      readonly excerpt?: string;
      readonly updatedAt?: string;
      readonly commentCount?: number;
    }
  | {
      readonly kind: typeof RESPONSE_KINDS.help;
      readonly commands: ReadonlyArray<{
        name: CommandName;
        usage: string;
        description: string;
      }>;
    }
  /** Requirement 4.4 / 7.6: which GROWI the link is for, and where to go. */
  | {
      readonly kind: typeof RESPONSE_KINDS.accountLinkRequired;
      readonly growiLabel: string;
      readonly linkUrl: string;
    }
  | {
      readonly kind: typeof RESPONSE_KINDS.error;
      readonly code:
        | 'forbidden'
        | 'path-conflict'
        | 'invalid'
        | 'not-permitted-in-channel'
        | 'no-settings'
        | 'unknown-kind';
      readonly message: string;
    };
