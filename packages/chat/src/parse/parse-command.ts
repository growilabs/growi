// Confirms the wire shape of a signed `CommandRequest` before it is trusted
// anywhere downstream (Requirement 10.1). Signature verification only shows
// the body wasn't altered in transit -- it says nothing about whether the
// body actually has the shape `CommandRequest` promises. This is the only
// one of task 6.2's 7 functions whose body carries its own discriminant
// (`kind`), so it is also the only one that can return `unknown-kind`
// (design.md's callout box directly above the parse* signatures) -- the
// other 6 have no `kind` field to be unknown about and return only
// `malformed`.

import { COMMAND_NAMES, type CommandName } from '../commands/command-names.js';
import {
  type CommandRequest,
  type CommandResponse,
  type KeepMessage,
  RESPONSE_KINDS,
  type SearchResultItem,
} from '../contract/command.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import { parseChannelRef, parseChatAccountRef } from './common-fields.js';
import { arr, isRecord, oneOf, str } from './shape.js';

// Defensive upper bounds (see `common-fields.ts`'s comment for why these are
// hand-picked rather than derived from design.md, which leaves the exact
// numbers to this task). Generous enough that no legitimate request is ever
// rejected, finite so a compromised-but-still-keyholding peer can't stall
// the receiving side with an oversized body.
const RELATION_ID_MAX = 128;
const REQUEST_ID_MAX = 128;
const KEYWORD_MAX = 500;
/** A search results page; nothing in this protocol needs more than this per request. */
const SEARCH_LIMIT_MAX = 100;
/** A GROWI page path -- generous for any realistic hierarchy depth. */
const PATH_MAX = 4000;
/**
 * A page body arriving from `create-page`. An empty body is a legitimate
 * GROWI page (task 6.1's Implementation Notes), so `body` is checked by
 * hand below instead of being routed through `str` (which rejects empty
 * strings unconditionally).
 */
const BODY_MAX = 200_000;
const MESSAGES_MAX = 200;
const POSTED_AT_MAX = 64;
/**
 * A single kept chat message's markdown -- smaller than a page body. An
 * empty value is legitimate (an attachment/image-only chat message has no
 * text body), so this is checked by hand, not via `str` (see `body` below).
 */
const KEEP_MARKDOWN_MAX = 20_000;
const PAGE_URL_MAX = 2000;

type ParseError = { readonly error: 'malformed' | 'unknown-kind' };

const COMMAND_NAME_VALUES: ReadonlyArray<CommandName> =
  Object.values(COMMAND_NAMES);

const parseSearchLimit = (v: unknown): number | undefined =>
  typeof v === 'number' &&
  Number.isInteger(v) &&
  v >= 1 &&
  v <= SEARCH_LIMIT_MAX
    ? v
    : undefined;

const parseKeepMessage = (v: unknown): KeepMessage | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const postedAt = str(v.postedAt, POSTED_AT_MAX);
  const author = parseChatAccountRef(v.author);
  const markdown =
    typeof v.markdown === 'string' && v.markdown.length <= KEEP_MARKDOWN_MAX
      ? v.markdown
      : undefined;

  if (
    postedAt === undefined ||
    author === undefined ||
    markdown === undefined
  ) {
    return undefined;
  }

  return { postedAt, author, markdown };
};

export const parseCommandRequest = (
  raw: unknown,
): CommandRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  // This parser only ever accepts `op === 'command'`: `oneOf` with a
  // single-member allowed list both confirms `op` is a real `OP_NAMES`
  // member AND that it's the one value this specific endpoint allows.
  const op = oneOf(raw.op, [OP_NAMES.command]);
  const requestId = str(raw.requestId, REQUEST_ID_MAX);
  const actor = parseChatAccountRef(raw.actor);
  const channel = parseChannelRef(raw.channel);

  if (
    relationId === undefined ||
    op === undefined ||
    requestId === undefined ||
    actor === undefined ||
    channel === undefined
  ) {
    return { error: 'malformed' };
  }

  const kind = oneOf(raw.kind, COMMAND_NAME_VALUES);
  if (kind === undefined) {
    return { error: 'unknown-kind' };
  }

  const envelope = { relationId, op, requestId, actor, channel };

  switch (kind) {
    case COMMAND_NAMES.search: {
      const keyword = str(raw.keyword, KEYWORD_MAX);
      const limit = parseSearchLimit(raw.limit);
      if (keyword === undefined || limit === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, keyword, limit };
    }
    case COMMAND_NAMES.createPage: {
      const path = str(raw.path, PATH_MAX);
      const body =
        typeof raw.body === 'string' && raw.body.length <= BODY_MAX
          ? raw.body
          : undefined;
      if (path === undefined || body === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, path, body };
    }
    case COMMAND_NAMES.keep: {
      const path = str(raw.path, PATH_MAX);
      const messages = arr(raw.messages, MESSAGES_MAX, parseKeepMessage);
      if (path === undefined || messages === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, path, messages };
    }
    case COMMAND_NAMES.linkPreview: {
      const pageUrl = str(raw.pageUrl, PAGE_URL_MAX);
      if (pageUrl === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, pageUrl };
    }
    case COMMAND_NAMES.help: {
      return { ...envelope, kind };
    }
    default: {
      // Unreachable: COMMAND_NAME_VALUES enumerates all 5 CommandName
      // members and `kind` was already narrowed to one of them above.
      return { error: 'unknown-kind' };
    }
  }
};

// ---------------------------------------------------------------------------
// parseCommandResponse (task 6.4)
//
// Unlike CommandRequest, CommandResponse carries no shared envelope --
// design.md's contract type is a bare 6-member discriminated union with no
// `relationId`/`op` common to all variants. So there is no "envelope fields"
// stage here: `kind` is read first, and each variant validates only its own
// fields (same all-or-nothing rule as everywhere else in this package: a
// response is either the fully-typed value or an error, never partial).
//
// This function is the response-side counterpart of `parseCommandRequest`
// and reuses ONLY that -- no other response parser in this file (`created`,
// `link-preview`, ...) is even called from `parseCommandRequest`'s side, so
// nothing here duplicates request-side logic; it duplicates only the
// established CONVENTION (bounded str/arr/oneOf, all-or-nothing arrays).

/** A search-results page; matches the request side's own `limit` cap. */
const ITEMS_MAX = SEARCH_LIMIT_MAX;
const TITLE_MAX = 500;
/** A page rank/position. Generous: no real result set is anywhere near this size. */
const RANK_MAX = 1_000_000;
const RESULT_UPDATED_AT_MAX = 64;
const COMMENT_COUNT_MAX = 1_000_000;
/**
 * `importedMessageCount` counts kept chat messages, so it can never exceed
 * `CommandRequest`'s own `keep.messages` array bound.
 */
const IMPORTED_MESSAGE_COUNT_MAX = MESSAGES_MAX;
const EXCERPT_MAX = 2000;
/** The command vocabulary is small (5 names); generous headroom for growth. */
const COMMANDS_MAX = 50;
const USAGE_MAX = 200;
const DESCRIPTION_MAX = 500;
const ACCOUNT_LINK_LABEL_MAX = 256;
const ERROR_MESSAGE_MAX = 2000;

const APPLIED_AS_VALUES = ['linked-user', 'anonymous'] as const;
const ERROR_CODES = [
  'forbidden',
  'path-conflict',
  'invalid',
  'not-permitted-in-channel',
  'no-settings',
  'unknown-kind',
] as const;

const RESPONSE_KIND_VALUES = Object.values(RESPONSE_KINDS);

/** Non-negative integer bounded by `max` (0 is a legitimate count -- e.g. `commentCount: 0`). */
const parseNonNegativeInt = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
    ? v
    : undefined;

/** Positive integer bounded by `max` (a rank/position is never 0 or negative). */
const parsePositiveInt = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max
    ? v
    : undefined;

const parseSearchResultItem = (v: unknown): SearchResultItem | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const rank = parsePositiveInt(v.rank, RANK_MAX);
  const path = str(v.path, PATH_MAX);
  const title = str(v.title, TITLE_MAX);
  const url = str(v.url, PAGE_URL_MAX);
  const updatedAt = str(v.updatedAt, RESULT_UPDATED_AT_MAX);
  const commentCount = parseNonNegativeInt(v.commentCount, COMMENT_COUNT_MAX);

  if (
    rank === undefined ||
    path === undefined ||
    title === undefined ||
    url === undefined ||
    updatedAt === undefined ||
    commentCount === undefined
  ) {
    return undefined;
  }

  return { rank, path, title, url, updatedAt, commentCount };
};

type HelpResponse = Extract<
  CommandResponse,
  { readonly kind: typeof RESPONSE_KINDS.help }
>;
type HelpCommandEntry = HelpResponse['commands'][number];

const parseHelpCommandEntry = (v: unknown): HelpCommandEntry | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const name = oneOf(v.name, COMMAND_NAME_VALUES);
  const usage = str(v.usage, USAGE_MAX);
  const description = str(v.description, DESCRIPTION_MAX);

  if (name === undefined || usage === undefined || description === undefined) {
    return undefined;
  }

  return { name, usage, description };
};

export const parseCommandResponse = (
  raw: unknown,
): CommandResponse | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const kind = oneOf(raw.kind, RESPONSE_KIND_VALUES);
  if (kind === undefined) {
    return { error: 'unknown-kind' };
  }

  switch (kind) {
    case RESPONSE_KINDS.search: {
      const items = arr(raw.items, ITEMS_MAX, parseSearchResultItem);
      const appliedAs = oneOf(raw.appliedAs, APPLIED_AS_VALUES);
      if (items === undefined || appliedAs === undefined) {
        return { error: 'malformed' };
      }
      return { kind, items, appliedAs };
    }
    case RESPONSE_KINDS.created: {
      const pageUrl = str(raw.pageUrl, PAGE_URL_MAX);
      if (pageUrl === undefined) {
        return { error: 'malformed' };
      }
      if (raw.importedMessageCount === undefined) {
        return { kind, pageUrl };
      }
      const importedMessageCount = parseNonNegativeInt(
        raw.importedMessageCount,
        IMPORTED_MESSAGE_COUNT_MAX,
      );
      if (importedMessageCount === undefined) {
        return { error: 'malformed' };
      }
      return { kind, pageUrl, importedMessageCount };
    }
    case RESPONSE_KINDS.linkPreview: {
      const path = str(raw.path, PATH_MAX);
      const restricted = raw.restricted;
      if (path === undefined || typeof restricted !== 'boolean') {
        return { error: 'malformed' };
      }

      let excerpt: string | undefined;
      if (raw.excerpt !== undefined) {
        excerpt = str(raw.excerpt, EXCERPT_MAX);
        if (excerpt === undefined) {
          return { error: 'malformed' };
        }
      }

      let updatedAt: string | undefined;
      if (raw.updatedAt !== undefined) {
        updatedAt = str(raw.updatedAt, RESULT_UPDATED_AT_MAX);
        if (updatedAt === undefined) {
          return { error: 'malformed' };
        }
      }

      let commentCount: number | undefined;
      if (raw.commentCount !== undefined) {
        commentCount = parseNonNegativeInt(raw.commentCount, COMMENT_COUNT_MAX);
        if (commentCount === undefined) {
          return { error: 'malformed' };
        }
      }

      return { kind, path, restricted, excerpt, updatedAt, commentCount };
    }
    case RESPONSE_KINDS.help: {
      const commands = arr(raw.commands, COMMANDS_MAX, parseHelpCommandEntry);
      if (commands === undefined) {
        return { error: 'malformed' };
      }
      return { kind, commands };
    }
    case RESPONSE_KINDS.accountLinkRequired: {
      const growiLabel = str(raw.growiLabel, ACCOUNT_LINK_LABEL_MAX);
      const linkUrl = str(raw.linkUrl, PAGE_URL_MAX);
      if (growiLabel === undefined || linkUrl === undefined) {
        return { error: 'malformed' };
      }
      return { kind, growiLabel, linkUrl };
    }
    case RESPONSE_KINDS.error: {
      const code = oneOf(raw.code, ERROR_CODES);
      const message = str(raw.message, ERROR_MESSAGE_MAX);
      if (code === undefined || message === undefined) {
        return { error: 'malformed' };
      }
      return { kind, code, message };
    }
    default: {
      // Unreachable: RESPONSE_KIND_VALUES enumerates all 6 ResponseKind
      // members and `kind` was already narrowed to one of them above.
      return { error: 'unknown-kind' };
    }
  }
};
